import { generate } from 'otplib';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createOwner, LOGIN_POLICY, newRecoveryCodes, totpUri, verifyOwnerLogin } from '../src';
import { describeDb, resetDb, testKey, testPrisma } from './helpers';

describe('helpers de 2FA', () => {
  it('gera códigos de recuperação únicos no formato xxxx-xxxx', () => {
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(LOGIN_POLICY.recoveryCodes);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[0-9a-f]{4}-[0-9a-f]{4}$/);
  });

  it('monta a URI otpauth para o app autenticador', () => {
    expect(totpUri('dono@exemplo.com', 'JBSWY3DPEHPK3PXP')).toMatch(/^otpauth:\/\/totp\//);
  });
});

describeDb('verifyOwnerLogin (integração)', () => {
  const prisma = testPrisma();
  const email = 'dono@exemplo.com';
  const password = 'senha-muito-forte-123';
  let secret = '';
  let recovery: string[] = [];
  const t0 = new Date('2026-11-09T12:00:00Z');
  const codeAt = (d: Date) => generate({ secret, epoch: Math.floor(d.getTime() / 1000) });

  beforeEach(async () => {
    await resetDb(prisma);
    const owner = await createOwner(prisma, testKey, { email, password });
    secret = owner.totpSecret;
    recovery = owner.recoveryCodes;
  });
  afterAll(() => prisma.$disconnect());

  it('não guarda senha nem segredo TOTP em texto puro', async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(u.passwordHash).not.toContain(password);
    expect(u.totpSecretEnc).not.toContain(secret);
    expect(u.recoveryCodeHashes.join()).not.toContain(recovery[0]);
  });

  it('aceita senha + código TOTP corretos', async () => {
    const r = await verifyOwnerLogin(
      prisma,
      testKey,
      { email, password, code: await codeAt(t0) },
      t0,
    );
    expect(r.ok).toBe(true);
  });

  it('recusa senha errada, código errado e falta de segundo fator', async () => {
    const code = await codeAt(t0);
    expect(
      (await verifyOwnerLogin(prisma, testKey, { email, password: 'x'.repeat(12), code }, t0)).ok,
    ).toBe(false);
    expect(
      (await verifyOwnerLogin(prisma, testKey, { email, password, code: '000000' }, t0)).ok,
    ).toBe(false);
    expect((await verifyOwnerLogin(prisma, testKey, { email, password, code: '' }, t0)).ok).toBe(
      false,
    );
  });

  it('não aceita o mesmo código TOTP duas vezes', async () => {
    const code = await codeAt(t0);
    expect((await verifyOwnerLogin(prisma, testKey, { email, password, code }, t0)).ok).toBe(true);
    const again = new Date(t0.getTime() + 5_000);
    expect((await verifyOwnerLogin(prisma, testKey, { email, password, code }, again)).ok).toBe(
      false,
    );
  });

  it('código de recuperação funciona uma única vez', async () => {
    const code = recovery[0] as string;
    const first = await verifyOwnerLogin(prisma, testKey, { email, password, code }, t0);
    expect(first).toMatchObject({ ok: true, usedRecoveryCode: true });
    expect((await verifyOwnerLogin(prisma, testKey, { email, password, code }, t0)).ok).toBe(false);
  });

  it('bloqueia após 5 falhas seguidas, mesmo com a senha certa depois', async () => {
    for (let i = 0; i < LOGIN_POLICY.maxFailures; i++) {
      await verifyOwnerLogin(
        prisma,
        testKey,
        { email, password: 'errada-errada', code: '123456' },
        t0,
      );
    }
    const r = await verifyOwnerLogin(
      prisma,
      testKey,
      { email, password, code: await codeAt(t0) },
      t0,
    );
    expect(r).toEqual({ ok: false, reason: 'locked' });
    const later = new Date(t0.getTime() + (LOGIN_POLICY.lockMinutes + 1) * 60_000);
    const ok = await verifyOwnerLogin(
      prisma,
      testKey,
      { email, password, code: await codeAt(later) },
      later,
    );
    expect(ok.ok).toBe(true);
  });

  it('grava auditoria de sucesso e de falha', async () => {
    await verifyOwnerLogin(prisma, testKey, { email, password, code: '000000' }, t0);
    await verifyOwnerLogin(prisma, testKey, { email, password, code: await codeAt(t0) }, t0);
    const logs = await prisma.auditLog.findMany({
      where: { action: 'auth.login' },
      orderBy: { at: 'asc' },
    });
    expect(logs.map((l) => l.outcome)).toEqual(['DENIED', 'OK']);
  });
});

describeDb('createOwner (integração)', () => {
  const prisma = testPrisma();
  afterAll(() => prisma.$disconnect());

  it('recriar o dono incrementa sessionVersion (derruba sessões abertas) e troca o segredo', async () => {
    await resetDb(prisma);
    const a = await createOwner(prisma, testKey, {
      email: 'x@exemplo.com',
      password: 'senha-muito-forte-1',
    });
    const before = await prisma.user.findUniqueOrThrow({ where: { email: 'x@exemplo.com' } });
    const b = await createOwner(prisma, testKey, {
      email: 'x@exemplo.com',
      password: 'senha-muito-forte-2',
    });
    const after = await prisma.user.findUniqueOrThrow({ where: { email: 'x@exemplo.com' } });
    expect(after.sessionVersion).toBe(before.sessionVersion + 1);
    expect(a.totpSecret).not.toBe(b.totpSecret);
  });

  it('mantém um único dono', async () => {
    await createOwner(prisma, testKey, {
      email: 'outro@exemplo.com',
      password: 'senha-muito-forte-3',
    });
    expect(await prisma.user.count()).toBe(1);
  });

  it('recusa senha curta e e-mail inválido', async () => {
    await expect(
      createOwner(prisma, testKey, { email: 'a@b.co', password: 'curta' }),
    ).rejects.toThrow();
    await expect(
      createOwner(prisma, testKey, { email: 'sem-arroba', password: 'senha-muito-forte' }),
    ).rejects.toThrow();
  });
});

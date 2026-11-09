import { randomBytes } from 'node:crypto';
import { hash, verify as verifyHash } from '@node-rs/argon2';
import { decryptSecret, encryptSecret } from '@studio/shared';
import { generateSecret, generateURI, verify as verifyTotp } from 'otplib';
import { audit } from './audit';
import type { PrismaClient } from './generated/prisma/client';

/** Parâmetros argon2id (OWASP: m ≥ 19 MiB, t ≥ 2). */
const ARGON2 = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const LOGIN_POLICY = {
  maxFailures: 5,
  lockMinutes: 15,
  minPasswordLength: 12,
  recoveryCodes: 10,
  /** Tolerância de relógio para o TOTP (segundos, para trás e para frente). */
  totpToleranceSeconds: 30,
} as const;

export const hashPassword = (plain: string) => hash(plain, ARGON2);
export const verifyPassword = (hashed: string, plain: string) =>
  verifyHash(hashed, plain).catch(() => false);

const totpContext = (email: string) => `owner:${email.toLowerCase()}:totp`;

export function newTotpSecret(): string {
  return generateSecret();
}

export function totpUri(email: string, secret: string, issuer = 'Radar Neon Studio'): string {
  return generateURI({ issuer, label: email, secret });
}

/** Códigos de recuperação no formato xxxx-xxxx (hex). */
export function newRecoveryCodes(n: number = LOGIN_POLICY.recoveryCodes): string[] {
  return Array.from({ length: n }, () => {
    const h = randomBytes(4).toString('hex');
    return `${h.slice(0, 4)}-${h.slice(4)}`;
  });
}

export interface CreateOwnerInput {
  email: string;
  password: string;
  totpSecret?: string;
}

export interface CreatedOwner {
  id: string;
  email: string;
  totpSecret: string;
  otpauthUri: string;
  recoveryCodes: string[];
}

/** Cria (ou recria) o único dono do painel. */
export async function createOwner(
  prisma: PrismaClient,
  key: Buffer,
  input: CreateOwnerInput,
): Promise<CreatedOwner> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('E-mail inválido');
  if (input.password.length < LOGIN_POLICY.minPasswordLength) {
    throw new Error(`A senha precisa ter pelo menos ${LOGIN_POLICY.minPasswordLength} caracteres`);
  }
  const totpSecret = input.totpSecret ?? newTotpSecret();
  const recoveryCodes = newRecoveryCodes();
  const data = {
    email,
    passwordHash: await hashPassword(input.password),
    totpSecretEnc: encryptSecret(totpSecret, key, totpContext(email)),
    recoveryCodeHashes: await Promise.all(recoveryCodes.map((c) => hash(c, ARGON2))),
    failedLoginCount: 0,
    lockedUntil: null,
    lastTotpStep: null,
  };
  const user = await prisma.$transaction(async (tx) => {
    // Painel de um usuário só: remove qualquer outro dono.
    await tx.user.deleteMany({ where: { email: { not: email } } });
    const u = await tx.user.upsert({
      where: { email },
      create: data,
      update: { ...data, sessionVersion: { increment: 1 } },
    });
    await audit(tx, { actor: 'system', action: 'owner.create', target: email });
    return u;
  });
  return {
    id: user.id,
    email,
    totpSecret,
    otpauthUri: totpUri(email, totpSecret),
    recoveryCodes,
  };
}

export type LoginFailure = 'invalid' | 'locked';
export type LoginResult =
  | {
      ok: true;
      user: { id: string; email: string; sessionVersion: number };
      usedRecoveryCode: boolean;
    }
  | { ok: false; reason: LoginFailure };

export interface LoginInput {
  email: string;
  password: string;
  /** Código de 6 dígitos do app autenticador OU um código de recuperação. */
  code: string;
  ip?: string;
}

/**
 * Verifica senha + segundo fator, com bloqueio após falhas seguidas e
 * proteção contra reutilização do mesmo código TOTP.
 * Mensagem de erro é sempre genérica para não revelar qual fator falhou.
 */
export async function verifyOwnerLogin(
  prisma: PrismaClient,
  key: Buffer,
  input: LoginInput,
  now: Date = new Date(),
): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  const auditBase = { actor: 'owner', action: 'auth.login', target: email };

  if (!user) {
    // Gasta o mesmo tempo de um hash para não revelar se o e-mail existe.
    await hashPassword(input.password);
    await audit(prisma, {
      ...auditBase,
      outcome: 'DENIED',
      details: { reason: 'unknown', ip: input.ip },
    });
    return { ok: false, reason: 'invalid' };
  }

  if (user.lockedUntil && user.lockedUntil > now) {
    await audit(prisma, {
      ...auditBase,
      outcome: 'DENIED',
      details: { reason: 'locked', ip: input.ip },
    });
    return { ok: false, reason: 'locked' };
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  const code = input.code.trim().replace(/\s+/g, '');
  let secondFactorOk = false;
  let usedRecoveryCode = false;
  let newTotpStep: number | null = null;
  let remainingRecovery = user.recoveryCodeHashes;

  if (passwordOk) {
    if (/^\d{6}$/.test(code)) {
      const secret = decryptSecret(user.totpSecretEnc, key, totpContext(email));
      const result = await verifyTotp({
        secret,
        token: code,
        epoch: Math.floor(now.getTime() / 1000),
        epochTolerance: LOGIN_POLICY.totpToleranceSeconds,
        ...(user.lastTotpStep === null ? {} : { afterTimeStep: user.lastTotpStep }),
      });
      if (result.valid) {
        secondFactorOk = true;
        // Time step RFC 6238 (período padrão de 30 s) em que o código casou.
        newTotpStep = Math.floor(now.getTime() / 1000 / 30) + result.delta;
      }
    } else if (/^[0-9a-f]{4}-?[0-9a-f]{4}$/i.test(code)) {
      const normalized = code.toLowerCase().replace(/^(\w{4})-?(\w{4})$/, '$1-$2');
      for (const h of user.recoveryCodeHashes) {
        if (await verifyHash(h, normalized).catch(() => false)) {
          secondFactorOk = true;
          usedRecoveryCode = true;
          remainingRecovery = user.recoveryCodeHashes.filter((x) => x !== h);
          break;
        }
      }
    }
  }

  if (!passwordOk || !secondFactorOk) {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= LOGIN_POLICY.maxFailures;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failures,
        lockedUntil: lock ? new Date(now.getTime() + LOGIN_POLICY.lockMinutes * 60_000) : null,
      },
    });
    await audit(prisma, {
      ...auditBase,
      outcome: 'DENIED',
      details: { reason: passwordOk ? 'second_factor' : 'password', locked: lock, ip: input.ip },
    });
    return { ok: false, reason: lock ? 'locked' : 'invalid' };
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginCount: 0,
      lockedUntil: null,
      lastLoginAt: now,
      recoveryCodeHashes: remainingRecovery,
      ...(newTotpStep === null ? {} : { lastTotpStep: newTotpStep }),
    },
  });
  await audit(prisma, {
    ...auditBase,
    details: { usedRecoveryCode, remainingRecoveryCodes: remainingRecovery.length, ip: input.ip },
  });
  return {
    ok: true,
    user: { id: user.id, email, sessionVersion: user.sessionVersion },
    usedRecoveryCode,
  };
}

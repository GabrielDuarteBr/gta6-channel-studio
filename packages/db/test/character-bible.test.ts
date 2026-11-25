import { DEFAULT_BIBLE } from '@studio/avatar';
import { afterAll, beforeEach, expect, it } from 'vitest';
import { activeBible, ensureBible, listBibleVersions, saveBibleVersion } from '../src';
import { describeDb, resetDb, testPrisma } from './helpers';

describeDb('bíblia do personagem (versionada e auditada)', () => {
  const prisma = testPrisma();
  beforeEach(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('sem nada no banco usa a padrão; a primeira subida grava a v1', async () => {
    expect((await activeBible(prisma)).version).toBe(0);
    expect(await ensureBible(prisma)).toBe(1);
    expect(await ensureBible(prisma)).toBeNull();
    const active = await activeBible(prisma);
    expect(active).toMatchObject({ version: 1, createdBy: 'system' });
    expect(active.content.name).toBe('Zeca Neon');
  });

  it('cada edição vira versão nova, auditada; a ativa é a maior', async () => {
    await ensureBible(prisma);
    const editada = { ...DEFAULT_BIBLE, voice: { ...DEFAULT_BIBLE.voice, pace: 'Bem rápido' } };
    expect(await saveBibleVersion(prisma, editada, 'owner', 'mais ritmo')).toBe(2);
    expect((await activeBible(prisma)).content.voice.pace).toBe('Bem rápido');
    expect((await listBibleVersions(prisma)).map((v) => v.version)).toEqual([2, 1]);
    const log = await prisma.auditLog.findMany({ where: { action: 'bible.version' } });
    expect(log.map((l) => l.target).sort()).toEqual(['v1', 'v2']);
  });

  it('bíblia padrão nunca editada é atualizada para a padrão nova; a do dono nunca', async () => {
    const antiga = { ...DEFAULT_BIBLE, summary: 'Versão antiga da bíblia padrão do Zeca Neon.' };
    expect(await saveBibleVersion(prisma, antiga, 'system', 'antiga')).toBe(1);
    expect(await ensureBible(prisma)).toBe(2);
    expect((await activeBible(prisma)).content.style?.format).toMatch(/youtuber/);
    expect(await ensureBible(prisma)).toBeNull(); // o jsonb reordena as chaves: não duplica
    await saveBibleVersion(prisma, antiga, 'owner', 'do meu jeito');
    expect(await ensureBible(prisma)).toBeNull();
    expect((await activeBible(prisma)).content.summary).toMatch(/Versão antiga/);
  });

  it('recusa versão que remove regra fixa (nada é gravado)', async () => {
    await ensureBible(prisma);
    const semRegra = {
      ...DEFAULT_BIBLE,
      rules: ['Pode falar de qualquer coisa.', ...DEFAULT_BIBLE.rules.slice(1)],
    };
    await expect(saveBibleVersion(prisma, semRegra, 'owner')).rejects.toThrow(/regras fixas/);
    expect((await activeBible(prisma)).version).toBe(1);
  });
});

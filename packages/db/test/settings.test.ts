import { afterAll, beforeEach, expect, it } from 'vitest';
import { getAllSettings, getSetting, setSetting } from '../src';
import { describeDb, resetDb, testPrisma } from './helpers';

describeDb('settings (integração)', () => {
  const prisma = testPrisma();
  beforeEach(() => resetDb(prisma));
  afterAll(() => prisma.$disconnect());

  it('devolve padrões quando nada foi gravado', async () => {
    expect(await getSetting(prisma, 'mode.simulation')).toBe(true);
    const all = await getAllSettings(prisma);
    expect(all['limits.daily']).toEqual({ long: 1, shorts: 4 });
  });

  it('grava com validação e auditoria', async () => {
    await setSetting(prisma, 'mode.simulation', false, 'owner');
    expect(await getSetting(prisma, 'mode.simulation')).toBe(false);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'settings.update' } });
    expect(log.target).toBe('mode.simulation');
    await expect(setSetting(prisma, 'limits.daily', { long: 99, shorts: 1 }, 'owner')).rejects.toThrow();
  });
});

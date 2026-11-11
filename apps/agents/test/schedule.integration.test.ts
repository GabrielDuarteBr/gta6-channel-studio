import { createPrisma } from '@studio/db';
import { createQueue, redisConnection } from '@studio/queue';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureResearchSchedule, slotJobId } from '../src/research/schedule';

const dbUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const d = dbUrl && redisUrl ? describe : describe.skip;

d('agendamento da coleta (recuperação sem duplicar)', () => {
  const prisma = createPrisma(dbUrl as string);
  const queue = createQueue('research', redisConnection(redisUrl as string));

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await prisma.jobRun.deleteMany();
  });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    await prisma.$disconnect();
  });

  it('sem coleta recente: agenda e dispara UMA recuperação, mesmo chamando duas vezes', async () => {
    const now = new Date('2026-11-10T08:07:00Z');
    const a = await ensureResearchSchedule(queue, prisma, 30, now);
    const b = await ensureResearchSchedule(queue, prisma, 30, new Date(now.getTime() + 60_000));
    expect(a.catchUp).toBe(true);
    expect(b.catchUp).toBe(true);
    const waiting = await queue.getJobs(['waiting', 'delayed', 'prioritized']);
    const catchUps = waiting.filter((j) => j.id === slotJobId('boot', 30, now));
    expect(catchUps).toHaveLength(1);
    const schedulers = await queue.getJobSchedulers();
    expect(schedulers.map((s) => s.key)).toContain('research-collect');
  });

  it('com coleta recente bem-sucedida: não dispara recuperação', async () => {
    const now = new Date('2026-11-10T08:07:00Z');
    await prisma.jobRun.create({
      data: {
        id: 'x',
        queue: 'research',
        name: 'collect',
        status: 'SUCCEEDED',
        finishedAt: new Date(now.getTime() - 10 * 60_000),
      },
    });
    const res = await ensureResearchSchedule(queue, prisma, 30, now);
    expect(res.catchUp).toBe(false);
  });
});

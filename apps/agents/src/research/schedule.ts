import type { PrismaClient } from '@studio/db';
import { deterministicJobId, type Queue } from '@studio/queue';

export const RESEARCH_SCHEDULER_ID = 'research-collect';
export const COLLECT_JOB = 'collect';

/** Id do job por "fatia" de tempo: o mesmo slot nunca gera dois jobs (sem duplicar ao acordar). */
export function slotJobId(kind: 'boot' | 'manual', intervalMinutes: number, now: Date): string {
  const slot = Math.floor(now.getTime() / (intervalMinutes * 60_000));
  return deterministicJobId('research', COLLECT_JOB, kind, slot);
}

/**
 * Agenda a coleta periódica (BullMQ, dentro do sistema — nunca cron da máquina) e,
 * se a última coleta bem-sucedida for mais antiga que o intervalo (notebook dormiu,
 * VPS reiniciou), dispara UMA coleta de recuperação.
 */
export async function ensureResearchSchedule(
  queue: Queue,
  prisma: PrismaClient,
  intervalMinutes: number,
  now: Date = new Date(),
): Promise<{ catchUp: boolean; lastSuccess: Date | null }> {
  await queue.upsertJobScheduler(
    RESEARCH_SCHEDULER_ID,
    { every: intervalMinutes * 60_000 },
    { name: COLLECT_JOB, data: { reason: 'agendada' } },
  );
  const last = await prisma.jobRun.findFirst({
    where: { queue: 'research', name: COLLECT_JOB, status: 'SUCCEEDED' },
    orderBy: { finishedAt: 'desc' },
    select: { finishedAt: true },
  });
  const lastSuccess = last?.finishedAt ?? null;
  const stale = !lastSuccess || now.getTime() - lastSuccess.getTime() > intervalMinutes * 60_000;
  if (stale) {
    await queue.add(
      COLLECT_JOB,
      { reason: 'recuperação' },
      { jobId: slotJobId('boot', intervalMinutes, now) },
    );
  }
  return { catchUp: stale, lastSuccess };
}

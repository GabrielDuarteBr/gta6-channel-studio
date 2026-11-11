import { getAllSettings, getPrisma } from '@studio/db';
import { createQueue, deterministicJobId, redisConnection } from '@studio/queue';
import { parseEnv, redisEnvSchema } from '@studio/shared';

export interface ResearchStatus {
  lastRun: {
    status: string;
    finishedAt: Date | null;
    startedAt: Date | null;
    result: Record<string, number> | null;
  } | null;
  running: boolean;
  intervalMinutes: number;
  nextRunAt: Date | null;
}

/** Estado da coleta para o cabeçalho da Pauta e a tela Saúde. */
export async function researchStatus(): Promise<ResearchStatus> {
  const prisma = getPrisma();
  const [settings, last, running] = await Promise.all([
    getAllSettings(prisma),
    prisma.jobRun.findFirst({
      where: { queue: 'research', name: 'collect', status: { in: ['SUCCEEDED', 'FAILED'] } },
      orderBy: { finishedAt: 'desc' },
    }),
    prisma.jobRun.count({ where: { queue: 'research', name: 'collect', status: 'RUNNING' } }),
  ]);
  const intervalMinutes = settings.research.intervalMinutes;
  const finished = last?.finishedAt ?? null;
  return {
    lastRun: last
      ? {
          status: last.status,
          finishedAt: finished,
          startedAt: last.startedAt,
          result: (last.result as Record<string, number> | null) ?? null,
        }
      : null,
    running: running > 0,
    intervalMinutes,
    nextRunAt: finished ? new Date(finished.getTime() + intervalMinutes * 60_000) : null,
  };
}

/**
 * Enfileira uma coleta manual. Id por minuto: cliques repetidos no mesmo minuto
 * não criam coletas duplicadas.
 */
export async function enqueueManualCollect(): Promise<string> {
  const { REDIS_URL } = parseEnv(redisEnvSchema);
  const queue = createQueue('research', redisConnection(REDIS_URL));
  try {
    const minute = new Date().toISOString().slice(0, 16);
    const jobId = deterministicJobId('research', 'collect', 'manual', minute);
    await queue.add('collect', { reason: 'manual' }, { jobId });
    return jobId;
  } finally {
    await queue.close();
  }
}

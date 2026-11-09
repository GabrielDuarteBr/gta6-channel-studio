import type { Prisma, PrismaClient } from '@studio/db';
import type { JobRecorder } from '@studio/queue';
import { scrubSecrets } from '@studio/shared';

const json = (v: unknown) => JSON.parse(JSON.stringify(v ?? null)) as Prisma.InputJsonValue;

/** Espelha o ciclo de vida dos jobs do BullMQ na tabela JobRun. */
export function prismaJobRecorder(prisma: PrismaClient): JobRecorder {
  return {
    async started(job) {
      const id = job.id ?? `${job.queueName}.${job.name}.${Date.now()}`;
      await prisma.jobRun.upsert({
        where: { id },
        create: {
          id,
          queue: job.queueName,
          name: job.name,
          status: 'RUNNING',
          attempts: job.attemptsMade + 1,
          payload: json(job.data),
          startedAt: new Date(),
        },
        update: {
          status: 'RUNNING',
          attempts: job.attemptsMade + 1,
          startedAt: new Date(),
          error: null,
        },
      });
    },
    async succeeded(job, result) {
      if (!job.id) return;
      await prisma.jobRun.update({
        where: { id: job.id },
        data: { status: 'SUCCEEDED', result: json(result), finishedAt: new Date() },
      });
    },
    async failed(job, error, willRetry) {
      if (!job.id) return;
      await prisma.jobRun.update({
        where: { id: job.id },
        data: {
          status: willRetry ? 'QUEUED' : 'FAILED',
          error: scrubSecrets(error.message).slice(0, 2_000),
          finishedAt: willRetry ? null : new Date(),
        },
      });
    },
  };
}

/**
 * Ao subir: jobs que estavam RUNNING quando o processo morreu (reinício,
 * notebook dormindo) viram INTERRUPTED. O BullMQ devolve esses jobs à fila
 * (detecção de jobs travados) e o id determinístico impede duplicatas.
 */
export async function markInterruptedJobs(prisma: PrismaClient, bootedAt: Date): Promise<number> {
  const { count } = await prisma.jobRun.updateMany({
    where: { status: 'RUNNING', updatedAt: { lt: bootedAt } },
    data: { status: 'INTERRUPTED' },
  });
  return count;
}

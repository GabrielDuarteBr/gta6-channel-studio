import { createHash } from 'node:crypto';
import {
  Queue,
  Worker,
  type ConnectionOptions,
  type Job,
  type JobsOptions,
  type Processor,
} from 'bullmq';

/** Filas separadas por tipo de trabalho, cada uma com concorrência própria. */
export const QUEUE_NAMES = [
  'research',
  'llm',
  'tts',
  'image',
  'render',
  'upload',
  'media',
  'system',
] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

/** Converte REDIS_URL em opções de conexão do BullMQ. */
export function redisConnection(redisUrl: string): ConnectionOptions {
  const u = new URL(redisUrl);
  const db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0;
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 6379,
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    db: Number.isFinite(db) ? db : 0,
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
    // Exigido pelo BullMQ para workers (comandos bloqueantes).
    maxRetriesPerRequest: null,
  };
}

/**
 * Id de job determinístico: o mesmo trabalho gera sempre o mesmo id,
 * então reenfileirar (reinício, notebook acordando) não duplica.
 * O BullMQ não aceita ":" em ids customizados.
 */
export function deterministicJobId(...parts: Array<string | number>): string {
  if (parts.length === 0) throw new Error('deterministicJobId precisa de pelo menos uma parte');
  const raw = parts
    .map((p) =>
      String(p)
        .trim()
        .replace(/[^A-Za-z0-9._-]+/g, '-'),
    )
    .join('.');
  if (raw.length <= 120) return raw;
  const digest = createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 24);
  return `${raw.slice(0, 95)}.${digest}`;
}

/** Retentativas com backoff exponencial; histórico limitado para não encher o Redis. */
export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 1_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export function createQueue<T = unknown>(name: QueueName, connection: ConnectionOptions): Queue<T> {
  return new Queue<T>(name, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
}

/** Grava o ciclo de vida dos jobs (no Postgres, via JobRun). Injetado pelo serviço. */
export interface JobRecorder {
  started(job: Job): Promise<void>;
  succeeded(job: Job, result: unknown): Promise<void>;
  failed(job: Job, error: Error, willRetry: boolean): Promise<void>;
}

export function createWorker<T = unknown, R = unknown>(
  name: QueueName,
  processor: Processor<T, R>,
  options: { connection: ConnectionOptions; concurrency: number; recorder?: JobRecorder },
): Worker<T, R> {
  const { recorder } = options;
  const wrapped: Processor<T, R> = async (job, token) => {
    await recorder?.started(job);
    try {
      const result = await processor(job, token);
      await recorder?.succeeded(job, result);
      return result;
    } catch (err) {
      const attempts = job.opts.attempts ?? 1;
      await recorder?.failed(job, err as Error, job.attemptsMade + 1 < attempts);
      throw err;
    }
  };
  return new Worker<T, R>(name, wrapped, {
    connection: options.connection,
    concurrency: options.concurrency,
    // Jobs de um worker que caiu (reinício, notebook dormindo) voltam para a fila.
    stalledInterval: 30_000,
    maxStalledCount: 2,
  });
}

export { Queue, Worker, type Job };

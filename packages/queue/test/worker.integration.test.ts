import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createQueue,
  createWorker,
  deterministicJobId,
  redisConnection,
  UnrecoverableError,
  type JobRecorder,
} from '../src';

const url = process.env.TEST_REDIS_URL;
const d = url ? describe : describe.skip;

d('fila + worker (integração com Redis)', () => {
  const connection = redisConnection(url as string);
  const queue = createQueue<{ n: number }>('system', connection);
  const events: string[] = [];
  const recorder: JobRecorder = {
    started: async (j) => void events.push(`start:${j.id}`),
    succeeded: async (j) => void events.push(`ok:${j.id}`),
    failed: async (j, _err, willRetry) => void events.push(`fail:${j.id}:${willRetry}`),
  };

  // Começa com a fila vazia: jobs velhos no Redis de desenvolvimento seriam pegos por este worker.
  beforeAll(async () => {
    await queue.obliterate({ force: true });
  });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it('processa um job e não duplica jobs com o mesmo id', async () => {
    const id = deterministicJobId('test', Date.now());
    await queue.add('heartbeat', { n: 1 }, { jobId: id });
    await queue.add('heartbeat', { n: 2 }, { jobId: id }); // ignorado: mesmo id
    const done = new Promise<number>((resolve) => {
      const worker = createWorker<{ n: number }, number>('system', async (job) => job.data.n * 10, {
        connection,
        concurrency: 1,
        recorder,
      });
      worker.on('completed', async (_job, result) => {
        await worker.close();
        resolve(result);
      });
    });
    expect(await done).toBe(10);
    expect(events).toEqual([`start:${id}`, `ok:${id}`]);
  });

  it('erro irrecuperável fica como falha (sem prometer nova tentativa)', async () => {
    events.length = 0;
    const id = deterministicJobId('test', 'irrecuperavel', Date.now());
    await queue.add('heartbeat', { n: 1 }, { jobId: id, attempts: 3 });
    await new Promise<void>((resolve) => {
      const worker = createWorker<{ n: number }, number>(
        'system',
        async () => {
          throw new UnrecoverableError('sem chave');
        },
        { connection, concurrency: 1, recorder },
      );
      worker.on('failed', async () => {
        await worker.close();
        resolve();
      });
    });
    expect(events).toEqual([`start:${id}`, `fail:${id}:false`]);
  });
});

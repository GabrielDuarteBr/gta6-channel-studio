import { audit, getAllSettings, getPrisma } from '@studio/db';
import { createQueue, createWorker, redisConnection, type Worker } from '@studio/queue';
import {
  baseEnvSchema,
  createLogger,
  databaseEnvSchema,
  parseEnv,
  profileDefaults,
  redisEnvSchema,
} from '@studio/shared';
import { startHealthServer } from './health-server';
import { markInterruptedJobs, prismaJobRecorder } from './job-recorder';
import { runResearch } from './research/pipeline';
import { COLLECT_JOB, ensureResearchSchedule } from './research/schedule';
import { seedDefaultSources } from './research/sources';

const log = createLogger('agents');
const env = parseEnv(baseEnvSchema.merge(databaseEnvSchema).merge(redisEnvSchema));
const profile = profileDefaults(env.APP_PROFILE);
const prisma = getPrisma();
const connection = redisConnection(env.REDIS_URL);
const bootedAt = new Date();

async function main(): Promise<void> {
  const interrupted = await markInterruptedJobs(prisma, bootedAt);
  if (interrupted > 0) log.warn({ interrupted }, 'jobs interrompidos no último desligamento');
  await audit(prisma, {
    actor: 'system',
    action: 'service.start',
    target: 'agents',
    details: { profile: env.APP_PROFILE, interrupted },
  });

  // Fila de sistema: batimento a cada 5 min (prova de vida das filas e do agendador).
  const systemQueue = createQueue('system', connection);
  await systemQueue.upsertJobScheduler(
    'heartbeat',
    { every: 5 * 60_000 },
    { name: 'heartbeat', data: {} },
  );

  // Pesquisa: fontes padrão, coleta agendada e recuperação após o notebook dormir.
  const seeded = await seedDefaultSources(prisma);
  if (seeded > 0) log.info({ seeded }, 'fontes padrão criadas');
  const researchQueue = createQueue('research', connection);
  let intervalMinutes = (await getAllSettings(prisma)).research.intervalMinutes;
  const schedule = await ensureResearchSchedule(researchQueue, prisma, intervalMinutes);
  log.info({ intervalMinutes, catchUp: schedule.catchUp }, 'coleta de notícias agendada');

  const pipelineCtx = {
    prisma,
    log,
    youtubeApiKey: process.env.YOUTUBE_API_KEY || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  };

  const workers: Worker[] = [
    // Uma coleta por vez (agendada, manual ou de recuperação).
    createWorker(
      'research',
      async (job) => {
        if (job.name !== COLLECT_JOB)
          throw new Error(`job desconhecido na fila research: ${job.name}`);
        const summary = await runResearch(pipelineCtx);
        // Se o intervalo mudou nas Configurações, reagenda.
        const current = (await getAllSettings(prisma)).research.intervalMinutes;
        if (current !== intervalMinutes) {
          intervalMinutes = current;
          await ensureResearchSchedule(researchQueue, prisma, intervalMinutes);
        }
        return {
          ok: summary.sources.filter((s) => s.status === 'ok').length,
          errors: summary.sources.filter((s) => s.status === 'erro').length,
          newItems: summary.sources.reduce((n, s) => n + s.newItems, 0),
          newStories: summary.clustering.newStories,
          triaged: summary.triage.triaged,
          seconds: summary.seconds,
        };
      },
      { connection, concurrency: 1, recorder: prismaJobRecorder(prisma) },
    ),
    createWorker(
      'system',
      async (job) => {
        if (job.name === 'heartbeat') return { at: new Date().toISOString() };
        throw new Error(`job desconhecido na fila system: ${job.name}`);
      },
      {
        connection,
        concurrency: profile.queueConcurrency.system,
        recorder: prismaJobRecorder(prisma),
      },
    ),
  ];
  for (const w of workers)
    w.on('failed', (job, err) => log.error({ job: job?.id, err }, 'job falhou'));

  const server = startHealthServer(Number(process.env.PORT ?? 4100), async () => {
    await prisma.$queryRaw`SELECT 1`;
    const [system, research] = await Promise.all([
      systemQueue.getJobCounts('waiting', 'active', 'failed'),
      researchQueue.getJobCounts('waiting', 'active', 'failed'),
    ]);
    return {
      status: 'ok',
      service: 'agents',
      profile: env.APP_PROFILE,
      queues: { system, research },
    };
  });
  log.info({ profile: env.APP_PROFILE, simulation: env.SIMULATION_MODE }, 'agents no ar');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'desligando com segurança');
    server.close();
    await Promise.allSettled(workers.map((w) => w.close()));
    await systemQueue.close();
    await researchQueue.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  log.fatal({ err }, 'falha ao iniciar');
  process.exit(1);
});

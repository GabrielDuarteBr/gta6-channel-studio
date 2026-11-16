import { audit, ensureBible, getAllSettings, getPrisma } from '@studio/db';
import { createQueue, createWorker, redisConnection, type Worker } from '@studio/queue';
import {
  baseEnvSchema,
  createLogger,
  databaseEnvSchema,
  parseEnv,
  profileDefaults,
  redisEnvSchema,
  s3EnvSchema,
  serviceUrlsEnvSchema,
} from '@studio/shared';
import { S3ObjectStore } from '@studio/storage';
import { CLIP_JOB } from './character/clip';
import { runClipJob } from './character/job';
import { FX_JOB, runFxUpdate } from './fx';
import { startHealthServer } from './health-server';
import { markInterruptedJobs, prismaJobRecorder } from './job-recorder';
import { runProductionJob } from './production/job';
import { PRODUCTION_JOB } from './production/pipeline';
import { runVariation, VARIATION_JOB } from './production/variation';
import { runResearch } from './research/pipeline';
import { COLLECT_JOB, ensureResearchSchedule, RESEARCH_SCHEDULER_ID } from './research/schedule';
import { applyDefaultSourceFixes, seedDefaultSources } from './research/sources';

const log = createLogger('agents');
const env = parseEnv(
  baseEnvSchema
    .merge(databaseEnvSchema)
    .merge(redisEnvSchema)
    .merge(serviceUrlsEnvSchema)
    .merge(s3EnvSchema),
);
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
  // Cotação do dólar (PTAX do Banco Central) para os valores em reais: ao subir e a cada 6 h.
  if (process.env.FX_SCHEDULE !== 'off') {
    await systemQueue.upsertJobScheduler(
      'fx-update',
      { every: 6 * 3_600_000 },
      { name: FX_JOB, data: {} },
    );
    await systemQueue.add(
      FX_JOB,
      {},
      { jobId: `fx.boot.${bootedAt.toISOString().slice(0, 13)}`, attempts: 3 },
    );
  } else {
    await systemQueue.removeJobScheduler('fx-update');
  }

  // Pesquisa: fontes padrão, coleta agendada e recuperação após o notebook dormir.
  const seeded = await seedDefaultSources(prisma);
  if (seeded > 0) log.info({ seeded }, 'fontes padrão criadas');
  const fixed = await applyDefaultSourceFixes(prisma);
  if (fixed.length > 0)
    log.warn({ fixed }, 'fontes padrão desativadas (correção registrada na auditoria)');
  const researchQueue = createQueue('research', connection);
  let intervalMinutes = (await getAllSettings(prisma)).research.intervalMinutes;
  // RESEARCH_SCHEDULE=off só na pilha de testes: sem coleta automática (a manual continua).
  const autoSchedule = process.env.RESEARCH_SCHEDULE !== 'off';
  if (autoSchedule) {
    const schedule = await ensureResearchSchedule(researchQueue, prisma, intervalMinutes);
    log.info({ intervalMinutes, catchUp: schedule.catchUp }, 'coleta de notícias agendada');
  } else {
    await researchQueue.removeJobScheduler(RESEARCH_SCHEDULER_ID);
    log.warn('coleta automática desligada (RESEARCH_SCHEDULE=off)');
  }

  const pipelineCtx = {
    prisma,
    log,
    youtubeApiKey: process.env.YOUTUBE_API_KEY || undefined,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  };

  // Personagem: bíblia v1 na primeira subida; clipes de teste na fila "render".
  const bibleSeeded = await ensureBible(prisma);
  if (bibleSeeded) log.info({ version: bibleSeeded }, 'bíblia do personagem criada');
  const renderQueue = createQueue('render', connection);
  const clipCtx = {
    prisma,
    log,
    mediaUrl: env.MEDIA_URL,
    renderUrl: env.RENDER_URL,
    googleApiKey: process.env.GOOGLE_TTS_API_KEY || undefined,
  };
  const productionCtx = {
    prisma,
    log,
    store: new S3ObjectStore(env),
    mediaUrl: env.MEDIA_URL,
    renderUrl: env.RENDER_URL,
    renderHeight: profile.renderHeight,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
    googleTtsKey: process.env.GOOGLE_TTS_API_KEY || undefined,
    geminiKey: process.env.GEMINI_API_KEY || undefined,
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
        if (autoSchedule && current !== intervalMinutes) {
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
      'render',
      async (job) => {
        if (job.name === CLIP_JOB) return runClipJob(clipCtx, job.data);
        if (job.name === PRODUCTION_JOB) {
          return runProductionJob(productionCtx, job.data, {
            made: job.attemptsMade,
            max: job.opts.attempts ?? 1,
          });
        }
        throw new Error(`job desconhecido na fila render: ${job.name}`);
      },
      {
        connection,
        concurrency: profile.queueConcurrency.render,
        recorder: prismaJobRecorder(prisma),
      },
    ),
    createWorker(
      'image',
      async (job) => {
        if (job.name === VARIATION_JOB) return runVariation(productionCtx, job.data);
        throw new Error(`job desconhecido na fila image: ${job.name}`);
      },
      {
        connection,
        concurrency: profile.queueConcurrency.image,
        recorder: prismaJobRecorder(prisma),
      },
    ),
    createWorker(
      'system',
      async (job) => {
        if (job.name === 'heartbeat') return { at: new Date().toISOString() };
        if (job.name === FX_JOB) return runFxUpdate({ prisma, log });
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
    const [system, research, render] = await Promise.all([
      systemQueue.getJobCounts('waiting', 'active', 'failed'),
      researchQueue.getJobCounts('waiting', 'active', 'failed'),
      renderQueue.getJobCounts('waiting', 'active', 'failed'),
    ]);
    return {
      status: 'ok',
      service: 'agents',
      profile: env.APP_PROFILE,
      queues: { system, research, render },
    };
  });
  log.info({ profile: env.APP_PROFILE, simulation: env.SIMULATION_MODE }, 'agents no ar');

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'desligando com segurança');
    server.close();
    await Promise.allSettled(workers.map((w) => w.close()));
    await systemQueue.close();
    await researchQueue.close();
    await renderQueue.close();
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

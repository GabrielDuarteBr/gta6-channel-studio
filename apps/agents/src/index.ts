import {
  audit,
  ensureBible,
  getAllSettings,
  getPrisma,
  Prisma,
  youtubeConnection,
} from '@studio/db';
import {
  CHAT_JOB,
  COMPLIANCE_JOB,
  createQueue,
  createWorker,
  DAILY_JOB,
  deterministicJobId,
  METRICS_JOB,
  redisConnection,
  UnrecoverableError,
  UPLOAD_JOB,
  type Worker,
} from '@studio/queue';
import {
  baseEnvSchema,
  channelDay,
  createLogger,
  databaseEnvSchema,
  encryptionEnvSchema,
  parseEnv,
  profileDefaults,
  redisEnvSchema,
  s3EnvSchema,
  serviceUrlsEnvSchema,
} from '@studio/shared';
import { S3ObjectStore } from '@studio/storage';
import { CLIP_JOB } from './character/clip';
import { chatJobSchema, runChatTurn } from './command/chat';
import { complianceJobSchema, runCompliance } from './publish/compliance';
import { runMetricsSync, settleSimulated } from './publish/metrics';
import { isPermanentUploadError, runUpload, uploadJobSchema } from './publish/upload';
import { NotConnectedError, youtubePublisher } from './publish/youtube';
import { dailyDue, dailyJobSchema, ranToday, runDailyProduction } from './schedule/daily';
import { runClipJob } from './character/job';
import { FX_JOB, runFxUpdate } from './fx';
import { startHealthServer } from './health-server';
import { markInterruptedJobs, prismaJobRecorder } from './job-recorder';
import { MediaService } from './character/services';
import { HUNT_JOB } from './partners/hunter';
import { ANALYZE_JOB, PARTNER_IMPORT_JOB } from './partners/import';
import { analyzeJobId, runAnalyzeJob, runHuntJob, runPartnerImportJob } from './partners/jobs';
import { runProductionJob } from './production/job';
import { PRODUCTION_JOB } from './production/pipeline';
import { productionJobId } from './production/job';
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
    .merge(s3EnvSchema)
    .merge(encryptionEnvSchema),
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

  // Parceiros: Caçador semanal (o liga/desliga fica nas Configurações; o job confere).
  // PARTNER_HUNT_SCHEDULE=off só na pilha de testes (sem rede real).
  if (process.env.PARTNER_HUNT_SCHEDULE !== 'off') {
    await researchQueue.upsertJobScheduler(
      'partners-hunt',
      { every: 7 * 24 * 3_600_000 },
      { name: HUNT_JOB, data: { scheduled: true } },
    );
  } else {
    await researchQueue.removeJobScheduler('partners-hunt');
  }
  const mediaQueue = createQueue('media', connection);
  const partnerCtx = {
    prisma,
    log,
    store: new S3ObjectStore(env),
    media: new MediaService(env.MEDIA_URL),
    // Drive: chave própria ou a do YouTube (mesmo projeto do Google Cloud, com a Drive API ativada).
    driveKey: process.env.GOOGLE_DRIVE_API_KEY || process.env.YOUTUBE_API_KEY || undefined,
    enqueueAnalysis: async (assetId: string) => {
      await mediaQueue.add(ANALYZE_JOB, { assetId }, { jobId: analyzeJobId(assetId), attempts: 2 });
    },
  };

  // Personagem: bíblia v1 na primeira subida; clipes de teste na fila "render".
  const bibleSeeded = await ensureBible(prisma);
  if (bibleSeeded) log.info({ version: bibleSeeded }, 'bíblia do personagem criada');
  const renderQueue = createQueue('render', connection);
  const llmQueue = createQueue('llm', connection);
  const uploadQueue = createQueue('upload', connection);
  const minute = () => new Date().toISOString().slice(0, 16);

  // Publicação (Fases 5–7): Conformidade quando o vídeo fica pronto, envio privado+agendado,
  // métricas e produção diária. O token do YouTube fica cifrado no banco.
  const publisher = () =>
    youtubePublisher(prisma, {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || undefined,
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || undefined,
      encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    });
  const youtubeConnected = async () => (await youtubeConnection(prisma))?.status === 'ok';
  const enqueueCompliance = async (productionId: string) => {
    await llmQueue.add(
      COMPLIANCE_JOB,
      { productionId },
      {
        jobId: deterministicJobId('llm', COMPLIANCE_JOB, productionId, minute()),
        attempts: 2,
      },
    );
  };
  const enqueueUpload = async (publicationId: string) => {
    await uploadQueue.add(
      UPLOAD_JOB,
      { publicationId },
      {
        jobId: deterministicJobId('upload', UPLOAD_JOB, publicationId, minute()),
        attempts: 8,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );
  };
  const enqueueProduction = async (productionId: string) => {
    await renderQueue.add(
      PRODUCTION_JOB,
      { productionId },
      { jobId: productionJobId(productionId), attempts: 2 },
    );
  };
  const enqueueHunt = async () => {
    await researchQueue.add(
      HUNT_JOB,
      {},
      { jobId: deterministicJobId('research', HUNT_JOB, 'comando', minute()), attempts: 1 },
    );
  };
  // Vídeos prontos antes desta versão (ou cuja Conformidade se perdeu) são conferidos agora.
  const unchecked = await prisma.production.findMany({
    where: { status: 'READY', compliance: { equals: Prisma.DbNull }, publication: null },
    select: { id: true },
    take: 30,
  });
  for (const p of unchecked) await enqueueCompliance(p.id);
  // Envios que estavam na fila quando o notebook desligou voltam para a fila.
  const pendingUploads = await prisma.publication.findMany({
    where: { status: { in: ['QUEUED', 'UPLOADING'] } },
    select: { id: true },
  });
  for (const p of pendingUploads) await enqueueUpload(p.id);

  // Produção diária: conferida a cada 5 min (o horário e o liga/desliga vêm das Configurações;
  // se o notebook dormiu no horário, roda quando acordar). DAILY_SCHEDULE=off só nos testes.
  const dailySchedule = process.env.DAILY_SCHEDULE !== 'off';
  const dailyTick = async () => {
    const now = new Date();
    await settleSimulated(prisma, now);
    if (!dailySchedule) return;
    const cfg = (await getAllSettings(prisma))['schedule.daily'];
    if (!cfg.enabled || !dailyDue(now, cfg.time) || (await ranToday(prisma, now))) return;
    await systemQueue.add(
      DAILY_JOB,
      {},
      { jobId: deterministicJobId('system', DAILY_JOB, channelDay(now)), attempts: 2 },
    );
  };
  // Métricas do YouTube a cada 3 h (só com o canal conectado). METRICS_SCHEDULE=off nos testes.
  if (process.env.METRICS_SCHEDULE !== 'off') {
    await systemQueue.upsertJobScheduler(
      'metrics-sync',
      { every: 3 * 3_600_000 },
      { name: METRICS_JOB, data: { scheduled: true } },
    );
  } else {
    await systemQueue.removeJobScheduler('metrics-sync');
  }
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
    // Vídeo pronto → Conformidade (título, descrição, fontes, regras) → fila de Aprovação.
    onReady: enqueueCompliance,
  };

  const workers: Worker[] = [
    // Uma coleta por vez (agendada, manual ou de recuperação).
    createWorker(
      'research',
      async (job) => {
        if (job.name === HUNT_JOB) return runHuntJob(pipelineCtx, job.data);
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
      'media',
      async (job) => {
        if (job.name === PARTNER_IMPORT_JOB) {
          return runPartnerImportJob(partnerCtx, job.data, {
            made: job.attemptsMade,
            max: job.opts.attempts ?? 1,
          });
        }
        if (job.name === ANALYZE_JOB) return runAnalyzeJob(partnerCtx, job.data);
        throw new Error(`job desconhecido na fila media: ${job.name}`);
      },
      {
        connection,
        concurrency: profile.queueConcurrency.media,
        recorder: prismaJobRecorder(prisma),
      },
    ),
    createWorker(
      'llm',
      async (job) => {
        if (job.name === COMPLIANCE_JOB) {
          const { productionId } = complianceJobSchema.parse(job.data);
          const report = await runCompliance(
            {
              prisma,
              log,
              anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
              enqueueUpload,
              youtubeConnected,
            },
            productionId,
          );
          return { ok: report.ok, failed: report.checks.filter((c) => !c.ok).map((c) => c.id) };
        }
        if (job.name === CHAT_JOB) {
          const { assistantMessageId } = chatJobSchema.parse(job.data);
          return runChatTurn(
            {
              prisma,
              log,
              anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
              enqueueProduction,
              enqueueHunt,
            },
            assistantMessageId,
          );
        }
        throw new Error(`job desconhecido na fila llm: ${job.name}`);
      },
      {
        connection,
        concurrency: profile.queueConcurrency.llm,
        recorder: prismaJobRecorder(prisma),
      },
    ),
    // Um envio por vez; a sessão resumable fica no banco (retoma do byte em que parou).
    createWorker(
      'upload',
      async (job) => {
        if (job.name !== UPLOAD_JOB)
          throw new Error(`job desconhecido na fila upload: ${job.name}`);
        const { publicationId } = uploadJobSchema.parse(job.data);
        try {
          return await runUpload({ prisma, log, publisher }, publicationId);
        } catch (err) {
          if (isPermanentUploadError(err)) throw new UnrecoverableError((err as Error).message);
          throw err;
        }
      },
      {
        connection,
        concurrency: profile.queueConcurrency.upload,
        recorder: prismaJobRecorder(prisma),
      },
    ),
    createWorker(
      'system',
      async (job) => {
        if (job.name === 'heartbeat') {
          await dailyTick();
          return { at: new Date().toISOString() };
        }
        if (job.name === FX_JOB) return runFxUpdate({ prisma, log });
        if (job.name === DAILY_JOB) {
          return runDailyProduction(
            { prisma, log, enqueueProduction },
            dailyJobSchema.parse(job.data),
          );
        }
        if (job.name === METRICS_JOB) {
          if (!(await youtubeConnected())) return { skipped: 'YouTube não conectado' };
          try {
            return await runMetricsSync({ prisma, log, publisher });
          } catch (err) {
            if (err instanceof NotConnectedError) throw new UnrecoverableError(err.message);
            throw err;
          }
        }
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
    const [system, research, render, media, llm, upload] = await Promise.all([
      systemQueue.getJobCounts('waiting', 'active', 'failed'),
      researchQueue.getJobCounts('waiting', 'active', 'failed'),
      renderQueue.getJobCounts('waiting', 'active', 'failed'),
      mediaQueue.getJobCounts('waiting', 'active', 'failed'),
      llmQueue.getJobCounts('waiting', 'active', 'failed'),
      uploadQueue.getJobCounts('waiting', 'active', 'failed'),
    ]);
    return {
      status: 'ok',
      service: 'agents',
      profile: env.APP_PROFILE,
      queues: { system, research, render, media, llm, upload },
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
    await mediaQueue.close();
    await llmQueue.close();
    await uploadQueue.close();
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

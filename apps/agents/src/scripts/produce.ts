/**
 * Produz um vídeo pela fila (o mesmo caminho do botão "Produzir") e espera terminar.
 *   docker compose exec agents node_modules/.bin/tsx src/scripts/produce.ts [opções]
 *   --formato=SHORT|LONG       (padrão SHORT)
 *   --historia=<id>            (padrão: a história mais bem pontuada que pode virar vídeo)
 *   --real                     produz de verdade (Claude, imagens e voz pagos) mesmo com o modo
 *                              simulado ligado. Respeita o teto de gasto.
 *   --repetir=<produção>       renderiza de novo o vídeo de uma produção pronta e compara os
 *                              quadros (prova de render repetível)
 *   --teste-direitos           cria uma produção com mídia sem direitos e confirma que o render
 *                              é recusado (regra 1/2, 3ª camada)
 * Não passa pelo limite diário (é teste do dono, nada é publicado). A última linha é um JSON.
 */
import {
  audit,
  currentFx,
  getAllSettings,
  getPrisma,
  type Prisma,
  type ProductionFormat,
} from '@studio/db';
import { canPromoteStory, type ContentFlags } from '@studio/policy';
import type { VideoPlan } from '@studio/production';
import { createQueue, redisConnection } from '@studio/queue';
import {
  formatBrl,
  parseEnv,
  redisEnvSchema,
  s3EnvSchema,
  serviceUrlsEnvSchema,
} from '@studio/shared';
import { MediaService, RenderService } from '../character/services';
import { productionJobId } from '../production/job';
import { PRODUCTION_JOB } from '../production/pipeline';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const flag = (name: string) => process.argv.includes(`--${name}`);

const env = parseEnv(redisEnvSchema.merge(serviceUrlsEnvSchema).merge(s3EnvSchema));
const prisma = getPrisma();
const queue = createQueue('render', redisConnection(env.REDIS_URL));
let code = 0;

async function pickStory(): Promise<string> {
  const explicit = arg('historia');
  if (explicit) return explicit;
  const settings = await getAllSettings(prisma);
  const candidates = await prisma.story.findMany({
    where: { status: { not: 'DISMISSED' }, itemCount: { gt: 0 } },
    orderBy: [{ score: 'desc' }],
    take: 40,
  });
  const ok = candidates.find(
    (s) =>
      canPromoteStory(
        {
          flags: s.flags as Partial<ContentFlags> | null,
          isRumor: s.isRumor,
          independentSources: s.independentSources,
          officialCount: s.officialCount,
        },
        settings.antiSpoiler,
      ).ok,
  );
  if (!ok) throw new Error('nenhuma história pode virar vídeo agora (rode make coletar)');
  return ok.id;
}

async function waitFor(id: string, timeoutMs = 45 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    const p = await prisma.production.findUniqueOrThrow({ where: { id } });
    const line = `${p.status}${p.step ? ` · ${p.step}` : ''}`;
    if (line !== last) console.log(`  ${new Date().toLocaleTimeString('pt-BR')} ${line}`);
    last = line;
    if (['READY', 'NEEDS_ATTENTION', 'FAILED', 'CANCELED'].includes(p.status)) return p;
    if (Date.now() > deadline) throw new Error('a produção passou de 45 minutos');
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function produce(storyId: string, format: ProductionFormat, real: boolean) {
  const story = await prisma.story.findUniqueOrThrow({ where: { id: storyId } });
  const prod = await prisma.production.create({
    data: {
      storyId,
      format,
      status: 'QUEUED',
      step: 'na fila (script)',
      title: story.titlePt ?? story.title,
      createdBy: 'owner:script',
    },
  });
  await queue.add(
    PRODUCTION_JOB,
    { productionId: prod.id, ...(real ? { real: true } : {}) },
    { jobId: productionJobId(prod.id), attempts: 2 },
  );
  await audit(prisma, {
    actor: 'owner:script',
    action: 'production.start',
    target: prod.id,
    details: { storyId, format, real },
  });
  console.log(`Produção ${prod.id} (${format}${real ? ', REAL' : ', simulada'}) na fila...`);
  const done = await waitFor(prod.id);
  const cost = await prisma.costLedger.aggregate({
    _sum: { costUsd: true },
    where: { productionId: prod.id },
  });
  const outputs = (done.outputs ?? {}) as Record<string, unknown>;
  const reviews = (done.review ?? []) as Array<{ approved: boolean; summary: string }>;
  return {
    id: done.id,
    format,
    real,
    status: done.status,
    error: done.error,
    title: done.title,
    video: outputs.video ?? null,
    thumbnails: outputs.thumbnails ?? [],
    thumbnail: outputs.thumbnail ?? null,
    durationSec: outputs.durationSec ?? null,
    rounds: done.reviewRound,
    review: reviews.at(-1) ?? null,
    renderReport: done.renderReport,
    costUsd: Number(cost._sum.costUsd ?? 0),
    costBrl: Number((await currentFx(prisma)).usdToBrl(Number(cost._sum.costUsd ?? 0)).toFixed(4)),
  };
}

async function rerender(productionId: string) {
  const p = await prisma.production.findUniqueOrThrow({ where: { id: productionId } });
  const plan = (p.plan as { video?: VideoPlan } | null)?.video;
  const video = (p.outputs as { video?: string } | null)?.video;
  if (!plan || !video) throw new Error('produção sem vídeo pronto');
  const render = new RenderService(env.RENDER_URL);
  const media = new MediaService(env.MEDIA_URL);
  const out = video.replace(/video\.mp4$/, 'video-repetido.mp4');
  console.log(`Renderizando de novo ${video} → ${out}...`);
  await render.render({
    composition: 'NewsVideo',
    props: { plan, provisional: true },
    output: out,
    vertical: plan.format === 'SHORT',
    height: plan.height > plan.width ? (plan.width as 720 | 1080) : (plan.height as 720 | 1080),
  });
  const [a, b] = await Promise.all([media.frameHashes(video), media.frameHashes(out)]);
  const same = a.hashes.filter((h, i) => h === b.hashes[i]).length;
  return {
    frames: a.frames,
    identical: same,
    allIdentical: a.frames === b.frames && same === a.frames,
  };
}

async function rightsTest(storyId: string) {
  // Mídia com manifesto revogado ligada a uma produção com imagens prontas: o render tem de recusar.
  const asset = await prisma.asset.findFirst({
    where: { manifest: { status: 'ACTIVE' } },
    orderBy: { createdAt: 'desc' },
  });
  if (!asset) throw new Error('Biblioteca vazia: rode uma produção antes');
  const story = await prisma.story.findUniqueOrThrow({ where: { id: storyId } });
  const source = await prisma.production.findFirst({
    where: { status: 'READY' },
    orderBy: { createdAt: 'desc' },
  });
  if (!source?.script) throw new Error('precisa de uma produção pronta antes');
  const copy = await prisma.asset.create({
    data: {
      origin: asset.origin,
      title: 'Teste de direitos (revogada)',
      storageKey: `${asset.storageKey}.teste-${Date.now()}`,
      sha256: `teste-${Date.now()}`,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
      createdBy: 'owner:script',
      tags: ['teste'],
      manifest: {
        create: {
          origin: asset.origin,
          license: 'teste de revogação',
          status: 'REVOKED',
          revokedAt: new Date(),
          revokedReason: 'teste do aceite',
          createdBy: 'owner:script',
        },
      },
    },
  });
  const plan = source.plan as Record<string, unknown> | null;
  const prod = await prisma.production.create({
    data: {
      storyId: story.id,
      format: source.format,
      status: 'QUEUED',
      script: source.script as Prisma.InputJsonValue,
      title: 'Teste de direitos',
      ...(plan
        ? {
            plan: {
              art: plan.art ?? {},
              ...(plan.voice ? { voice: plan.voice } : {}),
            } as Prisma.InputJsonValue,
          }
        : {}),
      createdBy: 'owner:script',
      assets: { create: [{ assetId: copy.id, role: 'cena', scene: 1 }] },
    },
  });
  await queue.add(
    PRODUCTION_JOB,
    { productionId: prod.id },
    { jobId: productionJobId(prod.id), attempts: 1 },
  );
  const done = await waitFor(prod.id, 10 * 60_000);
  await prisma.production.delete({ where: { id: prod.id } });
  await prisma.asset.delete({ where: { id: copy.id } });
  return {
    status: done.status,
    error: done.error,
    refused: done.status === 'FAILED' && /revogad/.test(done.error ?? ''),
  };
}

try {
  const repeat = arg('repetir');
  if (repeat) {
    console.log(JSON.stringify({ repetir: await rerender(repeat) }));
  } else if (flag('teste-direitos')) {
    console.log(JSON.stringify({ direitos: await rightsTest(await pickStory()) }));
  } else {
    const format = (arg('formato') ?? 'SHORT').toUpperCase() === 'LONG' ? 'LONG' : 'SHORT';
    const result = await produce(await pickStory(), format, flag('real'));
    console.log(
      result.status === 'READY'
        ? `Pronto: ${result.video} (${result.rounds} volta(s) de revisão, ${formatBrl(result.costBrl)})`
        : `Terminou como ${result.status}: ${result.error ?? ''}`,
    );
    console.log(JSON.stringify({ producao: result }));
    if (result.status !== 'READY') code = 1;
  }
} catch (err) {
  console.error(`Erro: ${(err as Error).message}`);
  code = 1;
} finally {
  await queue.close();
  await prisma.$disconnect();
}
process.exit(code);

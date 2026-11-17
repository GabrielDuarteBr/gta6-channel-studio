/**
 * Aceite da Fase 4: parceiro de teste + arquivo → Short de react, pelo mesmo caminho do painel.
 *   docker compose exec agents node_modules/.bin/tsx src/scripts/react.ts <passo>
 *   --preparar=<arquivo>   cria o parceiro de teste com permissão (prova escrita, condições),
 *                          envia o vídeo (pasta de trabalho) como se fosse pelo painel e espera
 *                          a importação e a análise (transcrição, fala, música)
 *   --produzir [--real]    produz um Short de react pela fila e espera (--real: Claude e voz
 *                          de verdade mesmo com o modo simulado; respeita o teto de gasto)
 *   --repetir=<produção>   renderiza de novo e compara os quadros (render repetível)
 *   --sem-permissao        suspende a permissão, tenta produzir (tem de parar) e reativa
 *   --youtube              tenta importar um link do YouTube (tem de ser recusado)
 *   --cacador              roda o Caçador uma vez (precisa da YOUTUBE_API_KEY)
 * Não passa pelo limite diário (teste do dono; nada é publicado). A última linha é um JSON.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { audit, currentFx, getPrisma, type Prisma } from '@studio/db';
import { parseShareLink, PolicyViolation } from '@studio/policy';
import type { ReactPlan } from '@studio/production';
import {
  createQueue,
  deterministicJobId,
  PARTNER_IMPORT_JOB,
  redisConnection,
} from '@studio/queue';
import {
  createLogger,
  formatBrl,
  parseEnv,
  redisEnvSchema,
  s3EnvSchema,
  serviceUrlsEnvSchema,
} from '@studio/shared';
import { S3ObjectStore } from '@studio/storage';
import { MediaService, RenderService } from '../character/services';
import { runHunt } from '../partners/hunter';
import { productionJobId } from '../production/job';
import { PRODUCTION_JOB } from '../production/pipeline';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const flag = (name: string) => process.argv.includes(`--${name}`);

const env = parseEnv(redisEnvSchema.merge(serviceUrlsEnvSchema).merge(s3EnvSchema));
const prisma = getPrisma();
const connection = redisConnection(env.REDIS_URL);
const TEST_CHANNEL = 'UCaceite000000000000000001';
let code = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clock = () => new Date().toLocaleTimeString('pt-BR');

async function testPartner() {
  const partner = await prisma.partner.upsert({
    where: { channelId: TEST_CHANNEL },
    create: {
      name: 'Parceiro de Teste (aceite)',
      channelId: TEST_CHANNEL,
      channelUrl: 'https://www.youtube.com/@parceirodeteste',
      stage: 'PARTNER',
      discoveredBy: 'owner',
      notes: 'Criado pelo aceite da Fase 4. Pode apagar.',
    },
    update: { stage: 'PARTNER' },
  });
  let permission = await prisma.partnerPermission.findFirst({
    where: { partnerId: partner.id, status: { in: ['ACTIVE', 'SUSPENDED'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!permission) {
    permission = await prisma.partnerPermission.create({
      data: {
        partnerId: partner.id,
        type: 'REACT_CLIPS',
        proofKind: 'OTHER',
        proof:
          'Teste do aceite da Fase 4: o vídeo é sintético (gerado pelo próprio estúdio), sem material de terceiros.',
        grantedAt: new Date(),
        conditions: {
          credit: 'Parceiro de Teste',
          link: 'https://www.youtube.com/@parceirodeteste',
          hashtag: '#parceirodeteste',
          monetization: 'not_allowed',
          maxClipSec: null,
          notes: null,
        } as Prisma.InputJsonValue,
        createdBy: 'owner:script',
      },
    });
  }
  return { partner, permission };
}

async function prepare(file: string) {
  const { partner, permission } = await testPartner();
  if (permission.status !== 'ACTIVE') {
    await prisma.partnerPermission.update({
      where: { id: permission.id },
      data: { status: 'ACTIVE' },
    });
  }
  const store = new S3ObjectStore(env);
  const size = (await stat(file)).size;
  const key = `incoming/${randomUUID()}.bin`;
  await store.putStream(key, createReadStream(file), size, 'application/octet-stream');
  const imp = await prisma.partnerImport.create({
    data: {
      partnerId: partner.id,
      permissionId: permission.id,
      source: 'upload',
      incomingKey: key,
      originalName: 'parceiro-teste.mp4',
      title: 'Vídeo de teste do aceite',
      createdBy: 'owner:script',
    },
  });
  const queue = createQueue('media', connection);
  await queue.add(
    PARTNER_IMPORT_JOB,
    { importId: imp.id },
    { jobId: deterministicJobId('media', PARTNER_IMPORT_JOB, imp.id), attempts: 3 },
  );
  await queue.close();
  console.log(`Importação ${imp.id} na fila...`);
  const deadline = Date.now() + 20 * 60_000;
  let last = '';
  for (;;) {
    const cur = await prisma.partnerImport.findUniqueOrThrow({ where: { id: imp.id } });
    const asset = cur.assetIds[0]
      ? await prisma.asset.findUnique({ where: { id: cur.assetIds[0] } })
      : null;
    const line = `importação ${cur.status}${asset ? ` · análise ${asset.analysisStatus}` : ''}`;
    if (line !== last) console.log(`  ${clock()} ${line}`);
    last = line;
    if (cur.status === 'FAILED') throw new Error(`importação falhou: ${cur.error}`);
    if (asset?.analysisStatus === 'FAILED')
      throw new Error(`análise falhou: ${asset.analysisError}`);
    if (asset?.analysisStatus === 'READY') {
      const a = asset.analysis as {
        segments: Array<{ text: string }>;
        speech: unknown[];
        music: unknown[];
        scenes: unknown[];
        language: string | null;
        model: string | null;
      };
      return {
        partnerId: partner.id,
        permissionId: permission.id,
        assetId: asset.id,
        durationSec: asset.durationSec,
        language: a.language,
        segments: a.segments.length,
        speech: a.speech.length,
        music: a.music.length,
        scenes: a.scenes.length,
        model: a.model,
        transcript: a.segments
          .map((s) => s.text)
          .join(' ')
          .slice(0, 200),
      };
    }
    if (Date.now() > deadline) throw new Error('importação/análise passou de 20 minutos');
    await sleep(2000);
  }
}

async function testAsset() {
  const { partner } = await testPartner();
  const asset = await prisma.asset.findFirst({
    where: { partnerId: partner.id, kind: 'VIDEO', analysisStatus: 'READY' },
    orderBy: { createdAt: 'desc' },
  });
  if (!asset) throw new Error('rode antes: react.ts --preparar=<arquivo>');
  return { partner, asset };
}

async function waitProduction(id: string, timeoutMs = 45 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  for (;;) {
    const p = await prisma.production.findUniqueOrThrow({ where: { id } });
    const line = `${p.status}${p.step ? ` · ${p.step}` : ''}`;
    if (line !== last) console.log(`  ${clock()} ${line}`);
    last = line;
    if (['READY', 'NEEDS_ATTENTION', 'FAILED', 'CANCELED'].includes(p.status)) return p;
    if (Date.now() > deadline) throw new Error('a produção passou de 45 minutos');
    await sleep(3000);
  }
}

async function produce(real: boolean) {
  const { partner, asset } = await testAsset();
  const prod = await prisma.production.create({
    data: {
      kind: 'REACT',
      format: 'SHORT',
      partnerId: partner.id,
      sourceAssetId: asset.id,
      status: 'QUEUED',
      step: 'na fila (script)',
      title: `React: ${asset.title}`,
      createdBy: 'owner:script',
    },
  });
  const queue = createQueue('render', connection);
  await queue.add(
    PRODUCTION_JOB,
    { productionId: prod.id, ...(real ? { real: true } : {}) },
    { jobId: productionJobId(prod.id), attempts: 2 },
  );
  await queue.close();
  await audit(prisma, {
    actor: 'owner:script',
    action: 'production.start',
    target: prod.id,
    details: { kind: 'REACT', assetId: asset.id, real },
  });
  console.log(`Short de react ${prod.id} (${real ? 'REAL' : 'simulado'}) na fila...`);
  const done = await waitProduction(prod.id);
  const cost = await prisma.costLedger.aggregate({
    _sum: { costUsd: true },
    where: { productionId: prod.id },
  });
  const usd = Number(cost._sum.costUsd ?? 0);
  const out = (done.outputs ?? {}) as Record<string, unknown>;
  const reviews = (done.review ?? []) as Array<{ approved: boolean; summary: string }>;
  const plan = (done.plan as { plan?: ReactPlan } | null)?.plan;
  return {
    id: done.id,
    real,
    status: done.status,
    error: done.error,
    title: done.title,
    video: out.video ?? null,
    durationSec: out.durationSec ?? null,
    clipRatio: out.clipRatio ?? null,
    commentRatio: out.commentRatio ?? null,
    description: out.description ?? null,
    monetization: out.monetization ?? null,
    layout: out.layout ?? null,
    audioMode: out.audioMode ?? null,
    blocks: plan?.blocks.map((b) => b.kind) ?? [],
    rounds: done.reviewRound,
    review: reviews.at(-1) ?? null,
    renderReport: done.renderReport,
    costUsd: usd,
    costBrl: Number((await currentFx(prisma)).usdToBrl(usd).toFixed(4)),
  };
}

async function rerender(productionId: string) {
  const p = await prisma.production.findUniqueOrThrow({ where: { id: productionId } });
  const plan = (p.plan as { plan?: ReactPlan } | null)?.plan;
  const video = (p.outputs as { video?: string } | null)?.video;
  if (!plan || !video) throw new Error('produção sem vídeo pronto');
  const render = new RenderService(env.RENDER_URL);
  const media = new MediaService(env.MEDIA_URL);
  const out = video.replace(/react\.mp4$/, 'react-repetido.mp4');
  console.log(`Renderizando de novo ${video} → ${out}...`);
  await render.render({
    composition: 'ReactShort',
    props: { plan, provisional: true },
    output: out,
    vertical: true,
    height: plan.width as 720 | 1080,
  });
  const [a, b] = await Promise.all([media.frameHashes(video), media.frameHashes(out)]);
  const same = a.hashes.filter((h, i) => h === b.hashes[i]).length;
  return {
    frames: a.frames,
    identical: same,
    allIdentical: a.frames === b.frames && same === a.frames,
  };
}

async function withoutPermission() {
  const { partner, asset } = await testAsset();
  const perm = await prisma.partnerPermission.findFirstOrThrow({
    where: { partnerId: partner.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'desc' },
  });
  await prisma.partnerPermission.update({ where: { id: perm.id }, data: { status: 'SUSPENDED' } });
  try {
    const prod = await prisma.production.create({
      data: {
        kind: 'REACT',
        format: 'SHORT',
        partnerId: partner.id,
        sourceAssetId: asset.id,
        status: 'QUEUED',
        title: 'Teste sem permissão',
        createdBy: 'owner:script',
      },
    });
    const queue = createQueue('render', connection);
    await queue.add(
      PRODUCTION_JOB,
      { productionId: prod.id },
      { jobId: productionJobId(prod.id), attempts: 2 },
    );
    await queue.close();
    const done = await waitProduction(prod.id, 10 * 60_000);
    return {
      refused: done.status === 'FAILED' && /permiss/i.test(done.error ?? ''),
      status: done.status,
      error: done.error,
    };
  } finally {
    await prisma.partnerPermission.update({ where: { id: perm.id }, data: { status: 'ACTIVE' } });
  }
}

function youtube() {
  try {
    parseShareLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    return { refused: false, error: null };
  } catch (err) {
    return { refused: err instanceof PolicyViolation, error: (err as Error).message };
  }
}

async function main() {
  const file = arg('preparar');
  const repeat = arg('repetir');
  if (file) {
    const r = await prepare(file);
    console.log(
      `Pronto: ${r.durationSec?.toFixed(1)} s, ${r.segments} trecho(s) de fala (${r.language}), ${r.scenes} troca(s) de cena. "${r.transcript}"`,
    );
    console.log(JSON.stringify({ preparar: r }));
  } else if (flag('produzir')) {
    const r = await produce(flag('real'));
    console.log(
      `Status: ${r.status} · clipe ${Math.round(Number(r.clipRatio ?? 0) * 100)}% · comentário ${Math.round(Number(r.commentRatio ?? 0) * 100)}% · custo ${formatBrl(r.costBrl)}`,
    );
    if (r.status !== 'READY') code = 1;
    console.log(JSON.stringify({ react: r }));
  } else if (repeat) {
    const r = await rerender(repeat);
    console.log(`${r.identical} de ${r.frames} quadros idênticos`);
    if (!r.allIdentical) code = 1;
    console.log(JSON.stringify({ repetir: r }));
  } else if (flag('sem-permissao')) {
    const r = await withoutPermission();
    console.log(r.refused ? `Parou: ${r.error}` : `NÃO parou (${r.status})`);
    if (!r.refused) code = 1;
    console.log(JSON.stringify({ semPermissao: r }));
  } else if (flag('youtube')) {
    const r = youtube();
    console.log(r.refused ? `Recusado: ${r.error}` : 'NÃO recusou');
    if (!r.refused) code = 1;
    console.log(JSON.stringify({ youtube: r }));
  } else if (flag('cacador')) {
    const r = await runHunt(
      {
        prisma,
        log: createLogger('cacador', 'warn'),
        youtubeApiKey: process.env.YOUTUBE_API_KEY || undefined,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
      },
      {},
    );
    console.log(
      r.skipped
        ? `Pulado: ${r.skipped}`
        : `${r.found} canal(is) achado(s), ${r.created} candidato(s) novo(s)`,
    );
    console.log(JSON.stringify({ cacador: r }));
  } else {
    console.error(
      'Use --preparar=<arquivo>, --produzir, --repetir=<id>, --sem-permissao, --youtube ou --cacador',
    );
    code = 2;
  }
}

main()
  .catch((err: unknown) => {
    console.error((err as Error).message);
    code = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(code);
  });

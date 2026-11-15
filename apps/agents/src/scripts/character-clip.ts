/**
 * Clipe de teste do Zeca pela fila (igual ao botão do painel), esperando terminar.
 *   docker compose exec agents node_modules/.bin/tsx src/scripts/character-clip.ts [--vertical] [--duas-vezes]
 *   (texto próprio: variável ROTEIRO)
 * --duas-vezes renderiza o mesmo clipe duas vezes e compara o hash de cada quadro.
 * A última linha é um JSON {"resumo": {...}} lido pelo scripts/accept-2.sh.
 */
import { getPrisma } from '@studio/db';
import { createQueue, redisConnection } from '@studio/queue';
import { parseEnv, redisEnvSchema, serviceUrlsEnvSchema } from '@studio/shared';
import { CLIP_JOB, type ClipResult } from '../character/clip';
import { clipJobId, clipJobSchema, type ClipJobData } from '../character/job';
import { MediaService } from '../character/services';

export const DEMO_SCRIPT =
  '[feliz] Fala, galera do Radar! Aqui é o Zeca Neon. [pausa] ' +
  '[surpreso] [aponta_tela] A Rockstar soltou novidade de GTA 6! ' +
  '[serio] Mas calma: o preço ainda é rumor, tá? [pausa:500] ' +
  '[debochado] E já tem gente vendendo o videogame pra comprar o jogo.';

const env = parseEnv(redisEnvSchema.merge(serviceUrlsEnvSchema));
const prisma = getPrisma();
const queue = createQueue('render', redisConnection(env.REDIS_URL));
const vertical = process.argv.includes('--vertical');
const twice = process.argv.includes('--duas-vezes');

async function runOnce(data: ClipJobData): Promise<ClipResult> {
  const jobId = clipJobId(data);
  await queue.add(CLIP_JOB, data, { jobId, attempts: 1 });
  console.log(`Clipe enfileirado (${jobId}). Esperando voz, bocas e render...`);
  const started = Date.now();
  for (;;) {
    const job = await queue.getJob(jobId);
    const state = job ? await job.getState() : 'sumiu';
    if (state === 'completed') return job!.returnvalue as ClipResult;
    if (state === 'failed') throw new Error(`o clipe falhou: ${job?.failedReason ?? ''}`);
    if (state === 'sumiu') throw new Error('o job sumiu da fila');
    if (Date.now() - started > 60 * 60_000) throw new Error('passou de 60 min');
    await new Promise((r) => setTimeout(r, 3000));
  }
}

let exitCode = 0;
try {
  const base = clipJobSchema.parse({
    script: process.env.ROTEIRO || DEMO_SCRIPT,
    layout: vertical ? 'vertical' : 'landscape',
  });
  const first = await runOnce({ ...base, ...(twice ? { variant: 'a' } : {}) });
  console.log(
    `\nVídeo: ${first.video} · ${first.durationSec.toFixed(1)} s · ${first.render.width}x${first.render.height} · render em ${first.render.seconds} s`,
  );
  console.log(
    `Expressões: ${first.expressions.join(', ')} · gestos: ${first.gestures.join(', ') || '—'} · bocas: ${first.mouthShapes.join('')} (${first.mouthCues} trocas) · voz: ${first.ttsProvider} (US$ ${first.ttsCostUsd.toFixed(4)})`,
  );
  let identical: boolean | null = null;
  let frames = 0;
  if (twice) {
    const second = await runOnce({ ...base, variant: 'b' });
    const media = new MediaService(env.MEDIA_URL);
    const [a, b] = await Promise.all([
      media.frameHashes(first.video),
      media.frameHashes(second.video),
    ]);
    frames = a.frames;
    identical =
      a.frames > 0 && a.frames === b.frames && a.hashes.every((h, i) => h === b.hashes[i]);
    const diff = a.hashes.findIndex((h, i) => h !== b.hashes[i]);
    console.log(
      identical
        ? `Dois renders: ${a.frames} quadros, todos com hash idêntico.`
        : `Dois renders DIFERENTES (${a.frames} x ${b.frames} quadros; primeiro diferente: ${diff}).`,
    );
  }
  console.log(
    JSON.stringify({
      resumo: {
        ok: true,
        video: first.video,
        segundos: first.durationSec,
        renderSegundos: first.render.seconds,
        largura: first.render.width,
        altura: first.render.height,
        expressoes: first.expressions,
        gestos: first.gestures,
        bocas: first.mouthShapes,
        trocasDeBoca: first.mouthCues,
        quadros: frames,
        identicos: identical,
      },
    }),
  );
} catch (err) {
  exitCode = 1;
  console.error(`❌ ${(err as Error).message}`);
  console.log(
    JSON.stringify({ resumo: { ok: false, erro: (err as Error).message.slice(0, 300) } }),
  );
} finally {
  await queue.close();
  await prisma.$disconnect();
}
process.exit(exitCode);

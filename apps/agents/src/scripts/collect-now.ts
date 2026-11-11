/**
 * Coleta agora pela MESMA fila do botão "Coletar agora" (nunca em paralelo com a
 * coleta automática), espera terminar e imprime o resultado por fonte. Usado pelo aceite.
 *   docker compose exec agents node_modules/.bin/tsx src/scripts/collect-now.ts
 * A última linha é um JSON {"resumo": {...}} lido pelo scripts/accept-1.sh.
 */
import { getAllSettings, getPrisma } from '@studio/db';
import { createQueue, deterministicJobId, redisConnection } from '@studio/queue';
import { parseEnv, redisEnvSchema } from '@studio/shared';
import { COLLECT_JOB, RESEARCH_SCHEDULER_ID } from '../research/schedule';

const TIMEOUT_MS = 30 * 60_000;
const prisma = getPrisma();
const { REDIS_URL } = parseEnv(redisEnvSchema);
const queue = createQueue('research', redisConnection(REDIS_URL));
const startedAt = new Date();

const jobId = deterministicJobId('research', COLLECT_JOB, 'cli', startedAt.toISOString());
await queue.add(COLLECT_JOB, { reason: 'manual' }, { jobId });
console.log(`Coleta enfileirada (${jobId}). Esperando o agents terminar…`);

let state = 'waiting';
while (Date.now() - startedAt.getTime() < TIMEOUT_MS) {
  const job = await queue.getJob(jobId);
  state = job ? await job.getState() : 'sumiu';
  if (state === 'completed' || state === 'failed' || state === 'sumiu') break;
  await new Promise((r) => setTimeout(r, 3000));
}
const run = await prisma.jobRun.findUnique({ where: { id: jobId } });
const result = (run?.result ?? {}) as Record<string, number>;
const collectOk = run?.status === 'SUCCEEDED';
if (!collectOk) {
  console.error(`❌ A coleta não terminou bem (estado: ${state}). ${run?.error ?? ''}`);
}

const settings = await getAllSettings(prisma);
const windowStart = new Date(Date.now() - settings.research.windowHours * 3_600_000);
const sources = await prisma.source.findMany({
  where: { enabled: true },
  orderBy: [{ tier: 'asc' }, { name: 'asc' }],
});
console.log('\nFonte                               Estado          GTA6  Erro');
for (const s of sources) {
  console.log(
    `${s.name.slice(0, 35).padEnd(36)}${(s.lastStatus ?? '—').padEnd(16)}${String(s.lastItemCount ?? 0).padStart(4)}  ${(s.lastError ?? '').slice(0, 90)}`,
  );
}

const stories = await prisma.story.findMany({
  where: { lastSeenAt: { gte: windowStart }, status: { not: 'DISMISSED' } },
  orderBy: { score: 'desc' },
  include: { items: { select: { url: true }, orderBy: { publishedAt: 'desc' } } },
});
const withLinks = stories.filter((s) => s.items.some((i) => /^https:\/\//.test(i.url)));
const multiSource = stories.filter((s) => s.independentSources >= 2);
const unscored = stories.filter((s) => !(s.score > 0) || s.scoreBreakdown === null);
const titles = new Map<string, number>();
for (const s of stories) {
  const t = s.title.toLowerCase().replace(/\s+/g, ' ').trim();
  titles.set(t, (titles.get(t) ?? 0) + 1);
}
const repeatedTitles = [...titles.values()].filter((n) => n > 1).length;
const items = await prisma.newsItem.count({ where: { fetchedAt: { gte: windowStart } } });
const autoRuns = await prisma.jobRun.count({
  where: {
    queue: 'research',
    name: COLLECT_JOB,
    status: 'SUCCEEDED',
    finishedAt: { gte: new Date(Date.now() - 65 * 60_000) },
    NOT: { payload: { path: ['reason'], equals: 'manual' } },
  },
});
const scheduler = await queue.getJobScheduler(RESEARCH_SCHEDULER_ID);
const schedulerMinutes = scheduler?.every ? Math.round(Number(scheduler.every) / 60_000) : 0;

console.log(
  `\nItens na janela: ${items} · histórias: ${stories.length} (${multiSource.length} com 2+ fontes) · novos nesta coleta: ${result.newItems ?? 0} · ${result.seconds ?? '?'}s`,
);
console.log(
  `Coleta automática: ${schedulerMinutes ? `a cada ${schedulerMinutes} min` : 'NÃO agendada'} · automáticas na última hora: ${autoRuns}`,
);
console.log('\nTop 10 da pauta:');
for (const s of stories.slice(0, 10)) {
  const tag = s.officialCount > 0 ? 'OFICIAL' : s.isRumor ? 'RUMOR' : 'IMPRENSA';
  console.log(
    `  ${s.score.toFixed(1).padStart(5)}  [${tag}] ${(s.titlePt ?? s.title).slice(0, 90)}  (${s.independentSources} fonte(s))`,
  );
  for (const i of s.items.slice(0, 2)) console.log(`         ${i.url}`);
}

console.log(
  JSON.stringify({
    resumo: {
      coletaOk: collectOk,
      segundos: result.seconds ?? null,
      fontesAtivas: sources.length,
      fontesOk: sources.filter((s) => s.lastStatus === 'ok' || s.lastStatus === 'sem novidades')
        .length,
      fontesErro: sources.filter((s) => s.lastStatus === 'erro').map((s) => s.name),
      itens: items,
      historias: stories.length,
      historiasComLink: withLinks.length,
      historiasMultiFonte: multiSource.length,
      semPontuacao: unscored.length,
      titulosRepetidos: repeatedTitles,
      agendadorMin: schedulerMinutes,
      automaticasUltimaHora: autoRuns,
    },
  }),
);
await queue.close();
await prisma.$disconnect();

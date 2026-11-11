/**
 * Roda a pesquisa agora, sem fila, e imprime o resultado por fonte (usado pelo aceite).
 *   docker compose exec agents node_modules/.bin/tsx src/scripts/collect-now.ts
 */
import { getPrisma } from '@studio/db';
import { createLogger } from '@studio/shared';
import { runResearch } from '../research/pipeline';
import { seedDefaultSources } from '../research/sources';

const prisma = getPrisma();
const log = createLogger('collect-now', 'warn');

await seedDefaultSources(prisma);
const summary = await runResearch({
  prisma,
  log,
  youtubeApiKey: process.env.YOUTUBE_API_KEY || undefined,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
});

console.log('\nFonte                               Estado          Lidos  GTA6  Novos');
for (const s of summary.sources) {
  console.log(
    `${s.source.padEnd(36)}${s.status.padEnd(16)}${String(s.fetched).padStart(5)}${String(s.relevant).padStart(6)}${String(s.newItems).padStart(7)}${s.error ? `  ${s.error.slice(0, 90)}` : ''}`,
  );
}
console.log(
  `\nHistórias novas: ${summary.clustering.newStories} · itens agrupados: ${summary.clustering.assigned} · triadas: ${summary.triage.triaged} · duplicatas unidas: ${summary.triage.merged}${summary.triage.skipped ? ` · triagem pausada: ${summary.triage.skipped}` : ''} · ${summary.seconds}s`,
);

const top = await prisma.story.findMany({
  where: { status: { not: 'DISMISSED' } },
  orderBy: { score: 'desc' },
  take: 10,
  include: { items: { select: { url: true }, take: 2 } },
});
console.log('\nTop 10 da pauta:');
for (const s of top) {
  const tag = s.officialCount > 0 ? 'OFICIAL' : s.isRumor ? 'RUMOR' : 'IMPRENSA';
  console.log(
    `  ${s.score.toFixed(1).padStart(5)}  [${tag}] ${(s.titlePt ?? s.title).slice(0, 90)}  (${s.independentSources} fonte(s))`,
  );
  for (const i of s.items) console.log(`         ${i.url}`);
}
console.log(
  JSON.stringify({
    resumo: {
      fontesOk: summary.sources.filter((s) => s.status === 'ok').length,
      historias: top.length,
    },
  }),
);
await prisma.$disconnect();

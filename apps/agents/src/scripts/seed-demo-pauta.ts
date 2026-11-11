/**
 * Dados de demonstração da Pauta — SÓ para a pilha isolada de testes (make e2e).
 * Recusa rodar sem DEMO_SEED=1. Desativa as fontes reais para o teste não depender
 * da internet e cria fontes "demo-*" servidas pelas amostras em test/fixtures.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPrisma } from '@studio/db';
import type { FetchLike } from '@studio/research';
import { createLogger } from '@studio/shared';
import { clusterAndScore, collectAll, triageStories } from '../research/pipeline';
import { seedDefaultSources } from '../research/sources';

if (process.env.DEMO_SEED !== '1') {
  console.error('Recusado: este script só roda na pilha de testes (DEMO_SEED=1).');
  process.exit(1);
}

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../../test/fixtures');
const fx = (name: string) => readFileSync(join(fixtures, name), 'utf8');
const routes: Record<string, string> = {
  'https://demo.radarneon.local/intel/feed': fx('wordpress-rss.xml'),
  'https://demo.radarneon.local/press/feed': fx('press-atom.xml'),
  'https://demo.radarneon.local/newswire': fx('newswire.html'),
};
const fakeFetch: FetchLike = async (url) =>
  routes[url] ? new Response(routes[url], { status: 200 }) : new Response('fora', { status: 503 });

const prisma = getPrisma();
const log = createLogger('seed-demo', 'warn');

await seedDefaultSources(prisma);
await prisma.source.updateMany({
  where: { key: { not: { startsWith: 'demo-' } } },
  data: { enabled: false },
});
const demo = [
  {
    key: 'demo-intel',
    name: 'Demo Comunidade',
    kind: 'RSS' as const,
    tier: 'COMMUNITY' as const,
    url: 'https://demo.radarneon.local/intel/feed',
    config: { gtaOnly: true },
  },
  {
    key: 'demo-press',
    name: 'Demo Imprensa',
    kind: 'RSS' as const,
    tier: 'PRESS' as const,
    url: 'https://demo.radarneon.local/press/feed',
  },
  {
    key: 'demo-newswire',
    name: 'Demo Newswire',
    kind: 'PAGE' as const,
    tier: 'OFFICIAL' as const,
    url: 'https://demo.radarneon.local/newswire',
    config: { linkPattern: '/newswire/article/', gtaOnly: true },
  },
];
for (const s of demo) {
  await prisma.source.upsert({ where: { key: s.key }, create: s, update: { enabled: true } });
}

await collectAll({ prisma, log, fetchImpl: fakeFetch });
// Datas recentes para as histórias caírem na janela da pauta.
const items = await prisma.newsItem.findMany({
  where: { source: { key: { startsWith: 'demo-' } } },
  orderBy: { publishedAt: 'asc' },
});
const now = Date.now();
for (const [i, item] of items.entries()) {
  await prisma.newsItem.update({
    where: { id: item.id },
    data: { publishedAt: new Date(now - (items.length - i) * 20 * 60_000) },
  });
}
await clusterAndScore({ prisma, log });
await triageStories({ prisma, log });
console.log(`demo: ${items.length} itens, ${await prisma.story.count()} histórias`);
await prisma.$disconnect();

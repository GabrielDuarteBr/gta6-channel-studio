import { containment, contentTokens, jaccard } from './text';

/** Tokens que aparecem em quase toda manchete do nicho e não ajudam a separar histórias. */
const UBIQUITOUS = new Set([
  'gta6',
  'rockstar',
  'taketwo',
  'game',
  'games',
  'jogo',
  'jogos',
  'news',
  'noticia',
  'noticias',
  'video',
  'videos',
  'update',
  'says',
  'said',
  'report',
  'reports',
  'fans',
  'fas',
  'gamers',
  'everything',
  'know',
  'tudo',
  'sabemos',
  'saber',
  'grand',
  'theft',
  'auto',
  'vi',
]);

export function storyTokens(title: string): Set<string> {
  return new Set(contentTokens(title).filter((t) => !UBIQUITOUS.has(t)));
}

const isNumber = (t: string) => /^\d+$/.test(t);

/** Semelhança entre duas manchetes (0..1). Números conflitantes (trailer 2 × trailer 3) derrubam a nota. */
export function headlineSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  let sim = Math.max(jaccard(a, b), Math.min(a.size, b.size) >= 3 ? 0.85 * containment(a, b) : 0);
  const na = [...a].filter(isNumber);
  const nb = [...b].filter(isNumber);
  if (na.length && nb.length && !na.some((n) => nb.includes(n))) sim *= 0.4;
  return sim;
}

export interface ClusterCandidate {
  /** Id da história existente ou chave temporária */
  key: string;
  tokenSets: Array<Set<string>>;
  lastSeenAt: Date;
}

export interface ClusterInput {
  id: string;
  title: string;
  publishedAt?: Date | undefined;
}

export const CLUSTER_THRESHOLD = 0.42;

/**
 * Agrupa itens novos em histórias (existentes ou novas) por semelhança de manchete,
 * dentro da janela de tempo. Determinístico: mesma entrada → mesmos grupos.
 */
export function clusterItems(
  items: ClusterInput[],
  existing: ClusterCandidate[],
  options: { windowHours: number; threshold?: number; now?: Date },
): Map<string, string> {
  const threshold = options.threshold ?? CLUSTER_THRESHOLD;
  const now = options.now ?? new Date();
  const windowMs = options.windowHours * 3_600_000;
  const candidates = existing
    .filter((c) => now.getTime() - c.lastSeenAt.getTime() <= windowMs)
    .map((c) => ({ ...c, tokenSets: [...c.tokenSets] }));
  const assignment = new Map<string, string>();
  const sorted = [...items].sort(
    (x, y) =>
      (x.publishedAt?.getTime() ?? 0) - (y.publishedAt?.getTime() ?? 0) || x.id.localeCompare(y.id),
  );
  let counter = 0;
  for (const item of sorted) {
    const tokens = storyTokens(item.title);
    let best: { key: string; sim: number } | undefined;
    for (const c of candidates) {
      const sim = Math.max(...c.tokenSets.map((s) => headlineSimilarity(tokens, s)));
      if (sim >= threshold && (!best || sim > best.sim)) best = { key: c.key, sim };
    }
    if (best) {
      assignment.set(item.id, best.key);
      const c = candidates.find((x) => x.key === best.key);
      c?.tokenSets.push(tokens);
      if (c && item.publishedAt && item.publishedAt > c.lastSeenAt) c.lastSeenAt = item.publishedAt;
    } else {
      const key = `new:${counter++}`;
      assignment.set(item.id, key);
      candidates.push({ key, tokenSets: [tokens], lastSeenAt: item.publishedAt ?? now });
    }
  }
  return assignment;
}

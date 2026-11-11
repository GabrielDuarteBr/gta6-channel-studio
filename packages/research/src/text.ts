/** Normalização de texto para comparar manchetes (PT e EN). */

const STOPWORDS = new Set(
  (
    'a o os as um uma uns umas de do da dos das em no na nos nas por para pra com sem sobre que e é ou ' +
    'se ao aos à às mais menos já foi ser são está estão tem têm vai vão novo nova novos novas ' +
    'the a an of to in on for with by at from and or is are was were be been it its this that these ' +
    'those as about after before new more than into over out up has have had will can could may ' +
    'here what why how when who all just now get gets got'
  ).split(/\s+/),
);

/** Sinônimos do jogo viram um só token, para manchetes em PT/EN casarem. */
const CANONICAL_PHRASES: Array<[RegExp, string]> = [
  [/\bgrand theft auto (vi|6)\b/g, ' gta6 '],
  [/\bgta[\s-]?(vi|6)\b/g, ' gta6 '],
  [/\bgtavi\b/g, ' gta6 '],
  [/\brockstar games\b/g, ' rockstar '],
  [/\btake[\s-]?two( interactive)?\b/g, ' taketwo '],
  [/\bvice city\b/g, ' vicecity '],
];

export function stripAccents(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/** Minúsculas, sem acento, sem pontuação, com os sinônimos do jogo unificados. */
export function normalizeText(text: string): string {
  let t = ` ${stripAccents(text.toLowerCase())} `;
  t = t.replace(/[‘’“”"'`´]/g, ' ');
  for (const [re, rep] of CANONICAL_PHRASES) t = t.replace(re, rep);
  t = t.replace(/[^a-z0-9]+/g, ' ');
  return t.trim().replace(/\s+/g, ' ');
}

/** Tokens de conteúdo (sem stopwords; números ficam: "trailer 3", "2026"). */
export function contentTokens(text: string): string[] {
  return normalizeText(text)
    .split(' ')
    .filter((w) => (w.length > 1 || /\d/.test(w)) && !STOPWORDS.has(w));
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Fração do menor conjunto contida no maior (manchete curta dentro de longa). */
export function containment(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (big.has(x)) inter++;
  return inter / small.size;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** Decodifica entidades HTML (numéricas e as nomeadas mais comuns). */
export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, ent: string) => {
    if (ent[0] === '#') {
      const code =
        ent[1]?.toLowerCase() === 'x' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? match;
  });
}

/** Remove tags HTML, decodifica entidades e tira espaços extras de resumos de feed. */
export function stripHtml(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

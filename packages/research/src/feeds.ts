import { XMLParser } from 'fast-xml-parser';
import { stripHtml } from './text';
import type { RawItem } from './types';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  htmlEntities: true,
  processEntities: true,
  trimValues: true,
  parseTagValue: false,
  // Feeds hostis: limita entidades para não explodir memória.
  isArray: (name) => ['item', 'entry', 'link', 'category'].includes(name),
});

type Node = Record<string, unknown> | string | undefined;

function text(node: unknown): string | undefined {
  if (node === undefined || node === null) return undefined;
  if (typeof node === 'string') return node.trim() || undefined;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['#text'];
    if (t !== undefined) return text(t);
  }
  return undefined;
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function atomLink(links: unknown): string | undefined {
  const list = (Array.isArray(links) ? links : [links]) as Node[];
  let fallback: string | undefined;
  for (const l of list) {
    if (typeof l === 'string') fallback ??= l;
    else if (l && typeof l === 'object') {
      const href = l['@_href'] as string | undefined;
      const rel = (l['@_rel'] as string | undefined) ?? 'alternate';
      if (href && rel === 'alternate') return href;
      fallback ??= href;
    }
  }
  return fallback;
}

export class FeedParseError extends Error {
  override name = 'FeedParseError';
}

/** Lê RSS 2.0, Atom e RDF/RSS 1.0 e devolve os itens (só metadados e link). */
export function parseFeed(xml: string): RawItem[] {
  if (xml.length > 5_000_000) throw new FeedParseError('feed grande demais');
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new FeedParseError(`XML inválido: ${(err as Error).message}`);
  }
  const rss = doc.rss as Record<string, unknown> | undefined;
  const rdf = doc['rdf:RDF'] as Record<string, unknown> | undefined;
  const feed = doc.feed as Record<string, unknown> | undefined;

  if (rss || rdf) {
    const channel = (rss?.channel ?? rdf) as Record<string, unknown> | undefined;
    const items =
      ((channel?.item ?? rdf?.item) as Array<Record<string, unknown>> | undefined) ?? [];
    return items
      .map((it) => {
        const link = text(it.link) ?? text(it.guid);
        const title = text(it.title);
        const description = text(it['content:encoded']) ?? text(it.description);
        return {
          url: link ?? '',
          title: title ? stripHtml(title) : '',
          summary: description ? stripHtml(description).slice(0, 600) : undefined,
          author: text(it['dc:creator']) ?? text(it.author),
          publishedAt: parseDate(text(it.pubDate) ?? text(it['dc:date'])),
        };
      })
      .filter((i) => i.url && i.title);
  }

  if (feed) {
    const entries = (feed.entry as Array<Record<string, unknown>> | undefined) ?? [];
    return entries
      .map((e) => {
        const title = text(e.title);
        const summary = text(e.summary) ?? text(e.content);
        const author = e.author as Record<string, unknown> | undefined;
        return {
          url: atomLink(e.link) ?? '',
          title: title ? stripHtml(title) : '',
          summary: summary ? stripHtml(summary).slice(0, 600) : undefined,
          author: text(author?.name),
          publishedAt: parseDate(text(e.published) ?? text(e.updated)),
        };
      })
      .filter((i) => i.url && i.title);
  }

  throw new FeedParseError('não é RSS nem Atom');
}

/** Parece XML de feed (e não uma página HTML)? */
export function looksLikeFeed(body: string): boolean {
  const head = body.slice(0, 2000).toLowerCase();
  return (
    /<(rss|feed|rdf:rdf)[\s>]/.test(head) || (head.includes('<?xml') && !head.includes('<html'))
  );
}

/** Autodescoberta: <link rel="alternate" type="application/rss+xml|atom+xml" href="..."> */
export function discoverFeedLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const rel = /\brel\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1]?.toLowerCase();
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (
      rel === 'alternate' &&
      href &&
      (type === 'application/rss+xml' || type === 'application/atom+xml')
    ) {
      try {
        out.push(new URL(href, baseUrl).toString());
      } catch {
        /* href inválido */
      }
    }
  }
  return [...new Set(out)];
}

/**
 * Para páginas sem feed: extrai links de artigos cujo caminho combina com o padrão.
 * Usa o texto do link como título (ou o atributo title/aria-label).
 */
export function extractArticleLinks(html: string, baseUrl: string, pattern: string): RawItem[] {
  const re = new RegExp(pattern);
  const seen = new Map<string, RawItem>();
  const anchors = html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi);
  for (const m of anchors) {
    const attrs = m[1] ?? '';
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (!href) continue;
    let url: string;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      continue;
    }
    if (!re.test(new URL(url).pathname)) continue;
    const label =
      stripHtml(m[2] ?? '') ||
      /\b(?:title|aria-label)\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1] ||
      '';
    if (label.length < 12) continue; // ícones e "leia mais"
    if (!seen.has(url)) seen.set(url, { url, title: label.slice(0, 300) });
  }
  return [...seen.values()];
}

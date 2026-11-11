import { detectContentFlags, looksLikeRumor } from '@studio/policy';
import { discoverFeedLinks, extractArticleLinks, looksLikeFeed, parseFeed } from './feeds';
import { fetchText, type FetchLike } from './fetchers/http';
import { isAboutGta6 } from './relevance';
import { normalizeText } from './text';
import type { CollectedItem, RawItem, SourceKind, SourceTier } from './types';
import { canonicalUrl, registrableDomain } from './url';

export interface SourceRecord {
  id: string;
  name: string;
  kind: SourceKind;
  tier: SourceTier;
  url: string;
  config?: { linkPattern?: string; gtaOnly?: boolean } | null;
  resolved?: { feedUrl?: string } | null;
  etag?: string | null;
  lastModified?: string | null;
}

export interface CollectResult {
  status: 'ok' | 'sem novidades' | 'erro';
  items: CollectedItem[];
  /** Itens lidos antes do filtro de relevância. */
  fetched: number;
  error?: string;
  etag?: string | undefined;
  lastModified?: string | undefined;
  resolved?: { feedUrl?: string };
}

/** Transforma itens crus em itens prontos (URL canônica, relevância, bandeiras, rumor). */
export function prepareItems(
  raw: RawItem[],
  source: Pick<SourceRecord, 'tier' | 'config' | 'url'>,
): CollectedItem[] {
  const gtaFocused = source.tier === 'OFFICIAL' || Boolean(source.config?.gtaOnly);
  const out = new Map<string, CollectedItem>();
  for (const item of raw) {
    const url = canonicalUrl(item.url, source.url);
    if (!url || !item.title) continue;
    if (!isAboutGta6(item.title, item.summary, gtaFocused)) continue;
    const text = `${item.title} ${item.summary ?? ''}`;
    out.set(url, {
      ...item,
      url,
      domain: registrableDomain(url),
      normalizedTitle: normalizeText(item.title),
      isRumor: source.tier !== 'OFFICIAL' && looksLikeRumor(text),
      flags: detectContentFlags(text),
    });
  }
  return [...out.values()];
}

/** Coleta de uma fonte RSS/página. YouTube tem coletor próprio (youtube.ts). */
export async function collectFeedSource(
  source: SourceRecord,
  fetchImpl: FetchLike = fetch,
): Promise<CollectResult> {
  try {
    const target = source.resolved?.feedUrl ?? source.url;
    const first = await fetchText(
      target,
      { etag: source.etag, lastModified: source.lastModified },
      fetchImpl,
    );
    if (first.notModified) return { status: 'sem novidades', items: [], fetched: 0 };

    let raw: RawItem[];
    let resolved: { feedUrl?: string } | undefined;
    let res = first;
    if (looksLikeFeed(first.body)) {
      raw = parseFeed(first.body);
    } else {
      // HTML: tenta autodescobrir o feed; senão, extrai links de artigo (PAGE).
      const feeds = discoverFeedLinks(first.body, first.finalUrl);
      if (feeds[0]) {
        res = await fetchText(feeds[0], {}, fetchImpl);
        raw = parseFeed(res.body);
        resolved = { feedUrl: feeds[0] };
      } else if (source.config?.linkPattern) {
        raw = extractArticleLinks(first.body, first.finalUrl, source.config.linkPattern);
      } else {
        return {
          status: 'erro',
          items: [],
          fetched: 0,
          error: 'a página não tem feed RSS/Atom nem padrão de links configurado',
        };
      }
    }
    const items = prepareItems(raw, source);
    return {
      status: 'ok',
      items,
      fetched: raw.length,
      etag: res.etag,
      lastModified: res.lastModified,
      ...(resolved ? { resolved } : {}),
    };
  } catch (err) {
    return { status: 'erro', items: [], fetched: 0, error: (err as Error).message.slice(0, 300) };
  }
}

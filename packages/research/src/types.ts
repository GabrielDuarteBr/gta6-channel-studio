/** Tipos compartilhados da pesquisa de notícias. */
import type { ContentFlags } from '@studio/policy';

export type SourceKind = 'RSS' | 'PAGE' | 'YOUTUBE_CHANNEL' | 'YOUTUBE_SEARCH';
export type SourceTier = 'OFFICIAL' | 'PRESS' | 'COMMUNITY';

export interface SourceDefinition {
  key: string;
  name: string;
  kind: SourceKind;
  tier: SourceTier;
  url: string;
  language: string;
  config?: { linkPattern?: string; gtaOnly?: boolean };
  enabled?: boolean;
}

/** Item como veio da fonte, antes de normalizar. */
export interface RawItem {
  url: string;
  title: string;
  summary?: string | undefined;
  author?: string | undefined;
  publishedAt?: Date | undefined;
  metrics?: Record<string, number> | undefined;
}

/** Item pronto para gravar. */
export interface CollectedItem extends RawItem {
  url: string; // canônica
  domain: string;
  normalizedTitle: string;
  isRumor: boolean;
  flags: ContentFlags;
}

export const TIER_WEIGHT: Record<SourceTier, number> = {
  OFFICIAL: 1.0,
  PRESS: 0.6,
  COMMUNITY: 0.3,
};

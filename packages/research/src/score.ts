import type { ContentFlags } from '@studio/policy';
import { TIER_WEIGHT, type SourceTier } from './types';

export interface ScoreItem {
  tier: SourceTier;
  domain: string;
  publishedAt: Date | null | undefined;
  fetchedAt: Date;
  isRumor: boolean;
  views?: number | undefined;
}

export interface ScoreInput {
  items: ScoreItem[];
  flags: Partial<ContentFlags> | null | undefined;
  /** 0..10, da triagem do Claude (opcional) */
  newsworthiness?: number | null | undefined;
}

export interface ScoreBreakdown {
  sources: number;
  official: number;
  corroboration: number;
  engagement: number;
  newsworthiness: number;
  recency: number;
  penalty: number;
  total: number;
}

const HALF_LIFE_HOURS = 24;

/** Pontuação da pauta: força das fontes × novidade, com penalidades de rumor e de política. */
export function scoreStory(input: ScoreInput, now: Date = new Date()): ScoreBreakdown {
  const byDomain = new Map<string, number>();
  let latest = 0;
  let maxViews = 0;
  let hasOfficial = false;
  let allRumor = input.items.length > 0;
  for (const it of input.items) {
    byDomain.set(it.domain, Math.max(byDomain.get(it.domain) ?? 0, TIER_WEIGHT[it.tier]));
    const t = (it.publishedAt ?? it.fetchedAt).getTime();
    if (t > latest) latest = t;
    if (it.views && it.views > maxViews) maxViews = it.views;
    if (it.tier === 'OFFICIAL') hasOfficial = true;
    if (!it.isRumor) allRumor = false;
  }
  const sources = Math.min(
    3,
    [...byDomain.values()].reduce((s, w) => s + w, 0),
  );
  const official = hasOfficial ? 1.5 : 0;
  const corroboration = Math.log2(1 + byDomain.size);
  const engagement = maxViews > 0 ? Math.min(3, Math.log10(maxViews + 1) / 2) : 0;
  const newsworthiness =
    input.newsworthiness != null ? (Math.max(0, Math.min(10, input.newsworthiness)) / 10) * 2 : 0;
  const hours = latest ? Math.max(0, (now.getTime() - latest) / 3_600_000) : 999;
  const recency = Math.pow(0.5, hours / HALF_LIFE_HOURS);
  const f = input.flags ?? {};
  let penalty = 1;
  if (allRumor && !hasOfficial) penalty *= 0.7;
  if (f.leak || f.onlineCheats || f.mods) penalty *= 0.3;
  const base = sources + official + corroboration + engagement + newsworthiness;
  const total = Math.round(base * recency * penalty * 10 * 10) / 10;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    sources: r2(sources),
    official,
    corroboration: r2(corroboration),
    engagement: r2(engagement),
    newsworthiness: r2(newsworthiness),
    recency: r2(recency),
    penalty: r2(penalty),
    total,
  };
}

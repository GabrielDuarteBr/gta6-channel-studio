import { PolicyViolation } from './rules';

/**
 * Bandeiras de política detectadas em manchetes/resumos (Regra 4 — Rockstar/Take-Two).
 * Heurística deliberadamente conservadora: na dúvida, bloqueia e explica.
 * A Conformidade (Fase 5) revisa com o Claude antes de qualquer publicação.
 */
export interface ContentFlags {
  /** Material vazado, cópia pré-lançamento, datamine — BLOQUEIA. */
  leak: boolean;
  /** Trapaça/hack em modo online — BLOQUEIA. */
  onlineCheats: boolean;
  /** Mods (não autorizados por padrão) — BLOQUEIA. */
  mods: boolean;
  /** Risco de spoiler de história (só conta dentro da janela pós-lançamento) — BLOQUEIA na janela. */
  spoilerRisk: boolean;
  /** Cutscene citada: aviso (não usar cutscene isolada no vídeo). */
  cutscene: boolean;
  /** Entretenimento in-game (rádio, TV, stand-up): aviso (não usar isolado). */
  inGameEntertainment: boolean;
}

export const NO_FLAGS: ContentFlags = {
  leak: false,
  onlineCheats: false,
  mods: false,
  spoilerRisk: false,
  cutscene: false,
  inGameEntertainment: false,
};

const strip = (t: string) =>
  ` ${t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')} `;

const LEAK =
  /\b(leak|leaks|leaked|leaker|vazou|vazam|vazamento|vazamentos|vazado|vazados|vazada|vazadas|datamine|datamined|datamining|dataminer|early copy|early copies|copia antecipada|copias antecipadas|pre release copy|pre release copies|street date broken)\b/;
const ONLINE = /\b(online|multiplayer|multijogador|gta online|lobby|lobbies)\b/;
const CHEAT =
  /\b(cheat|cheats|cheater|cheaters|cheating|hack|hacks|hacker|hackers|trapaca|trapacas|mod menu|mod menus|money glitch|exploit|exploits|aimbot|god mode)\b/;
const MOD_MENU = /\bmod menus?\b/;
const MODS = /\b(mod|mods|modded|modding|modder|modders)\b/;
const SPOILER =
  /\b(spoiler|spoilers|ending|endings|finale|plot twist|twist|dies|death of|who dies|final mission|last mission|secret ending|missao final|final secreto|finais|morre|morte de|reviravolta)\b/;
const CUTSCENE = /\b(cutscene|cutscenes|cinematica|cinematicas)\b/;
const IN_GAME_ENT =
  /\b(radio station|radio stations|estacao de radio|estacoes de radio|in game tv|tv show|stand up|standup|comedy club)\b/;

export interface SpoilerWindow {
  /** AAAA-MM-DD */
  launchDate: string;
  windowDays: number;
}

/** O anti-spoiler vale do lançamento até o fim da janela configurada. */
export function isSpoilerWindowActive(window: SpoilerWindow, now: Date = new Date()): boolean {
  const start = new Date(`${window.launchDate}T00:00:00-03:00`);
  const end = new Date(start.getTime() + window.windowDays * 86_400_000);
  return now >= start && now < end;
}

export function detectContentFlags(text: string): ContentFlags {
  const t = strip(text);
  return {
    leak: LEAK.test(t),
    onlineCheats: MOD_MENU.test(t) || (ONLINE.test(t) && CHEAT.test(t)),
    mods: MODS.test(t),
    spoilerRisk: SPOILER.test(t),
    cutscene: CUTSCENE.test(t),
    inGameEntertainment: IN_GAME_ENT.test(t),
  };
}

export function mergeFlags(list: ContentFlags[]): ContentFlags {
  const out = { ...NO_FLAGS };
  for (const f of list) {
    for (const k of Object.keys(out) as Array<keyof ContentFlags>) out[k] = out[k] || Boolean(f[k]);
  }
  return out;
}

export interface PromotableStory {
  flags: Partial<ContentFlags> | null | undefined;
  isRumor: boolean;
  /** Domínios independentes que noticiaram a história. */
  independentSources: number;
  officialCount: number;
}

export interface PromotionDecision {
  ok: boolean;
  /** Motivos de bloqueio (em português, para o painel). */
  reasons: string[];
  /** Avisos que não bloqueiam (vão para o roteirista/editor). */
  warnings: string[];
}

/**
 * Pode virar vídeo? Regra 4 (Rockstar) e Regra 6 (rumor com 2+ fontes independentes).
 */
export function canPromoteStory(
  story: PromotableStory,
  spoilerWindow: SpoilerWindow,
  now: Date = new Date(),
): PromotionDecision {
  const f = { ...NO_FLAGS, ...(story.flags ?? {}) };
  const reasons: string[] = [];
  const warnings: string[] = [];
  if (f.leak) reasons.push('Envolve vazamento ou cópia pré-lançamento (política da Rockstar).');
  if (f.onlineCheats) reasons.push('Envolve trapaça/hack em modo online (política da Rockstar).');
  if (f.mods) reasons.push('Envolve mods não autorizados (política da Rockstar).');
  if (f.spoilerRisk && isSpoilerWindowActive(spoilerWindow, now)) {
    reasons.push('Pode conter spoiler da história dentro da janela anti-spoiler.');
  }
  if (story.isRumor && story.officialCount === 0 && story.independentSources < 2) {
    reasons.push('Rumor com menos de 2 fontes independentes.');
  }
  if (f.cutscene) warnings.push('Cita cutscenes: não usar cutscene isolada no vídeo.');
  if (f.inGameEntertainment)
    warnings.push('Cita entretenimento in-game: não usar rádio/TV/stand-up isolados.');
  if (story.isRumor && reasons.length === 0)
    warnings.push('Rumor: rotular como rumor no roteiro e citar as fontes.');
  return { ok: reasons.length === 0, reasons, warnings };
}

/** Versão que lança PolicyViolation (para workers e ferramentas). */
export function assertCanPromoteStory(
  story: PromotableStory,
  spoilerWindow: SpoilerWindow,
  now: Date = new Date(),
): PromotionDecision {
  const decision = canPromoteStory(story, spoilerWindow, now);
  if (!decision.ok) {
    const rule =
      story.isRumor && decision.reasons.some((r) => r.startsWith('Rumor'))
        ? 'FACTS_HAVE_SOURCES'
        : 'ROCKSTAR_POLICY';
    throw new PolicyViolation(rule, decision.reasons.join(' '));
  }
  return decision;
}

/** Sinais de rumor na manchete/resumo. */
const RUMOR =
  /\b(rumor|rumors|rumour|rumours|rumores|boato|boatos|reportedly|insider|insiders|allegedly|supostamente|suposto|suposta|teria|teriam|could be|might be|pode ter|leakers?|according to sources|segundo fontes|speculation|especulacao|theory|teoria|claims?)\b/;

export function looksLikeRumor(text: string): boolean {
  return RUMOR.test(strip(text));
}

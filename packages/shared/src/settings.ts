import { z } from 'zod';
import { APP_PROFILES } from './config';

/**
 * Configurações editáveis no painel (tabela Setting).
 * Cada chave tem schema e valor padrão; valores inválidos no banco caem no padrão.
 */
export const SETTINGS = {
  'channel.identity': z
    .object({
      channelName: z.string().min(2).max(60),
      characterName: z.string().min(2).max(60),
      language: z.string().min(2).max(10),
    })
    .default({ channelName: 'Radar Neon', characterName: 'Zeca Neon', language: 'pt-BR' }),

  /** Sobrepõe o APP_PROFILE do .env nos ajustes do app (os limites dos containers seguem o Compose). */
  'profile.override': z.enum(['env', ...APP_PROFILES]).default('env'),

  /** TTS e imagem falsos, upload simulado. */
  'mode.simulation': z.boolean().default(true),

  /** Piloto automático (Fase 7). Desligado por padrão; só o dono liga. */
  'mode.autopilot': z.boolean().default(false),

  'limits.daily': z
    .object({
      long: z.number().int().min(0).max(5),
      shorts: z.number().int().min(0).max(20),
    })
    .default({ long: 1, shorts: 4 }),

  budget: z
    .object({
      monthlyUsd: z.number().min(0).max(10_000),
      dailyUsd: z.number().min(0).max(1_000),
    })
    .default({ monthlyUsd: 50, dailyUsd: 1.6 }),

  'render.resolution': z.enum(['auto', '720p', '1080p']).default('auto'),

  /** Pesquisa de notícias (Fase 1). */
  research: z
    .object({
      intervalMinutes: z.number().int().min(10).max(1440),
      windowHours: z.number().int().min(12).max(336),
      youtubeSearchesPerDay: z.number().int().min(0).max(20),
    })
    .default({ intervalMinutes: 30, windowHours: 72, youtubeSearchesPerDay: 4 }),

  /**
   * Personagem (Fase 2). Voz: 'fake' (espeak, teste) ou 'google' (Chirp 3 HD). Com o modo
   * simulado ligado, os clipes usam a voz de teste (salvo pedido explícito no clipe).
   * A trava para em 95% da cota grátis do mês, a não ser que o dono libere pagar.
   */
  character: z
    .object({
      ttsProvider: z.enum(['fake', 'google']),
      googleVoice: z.string().regex(/^[a-z]{2,3}-[A-Z]{2}-Chirp3-HD-[A-Za-z]+$/),
      speakingRate: z.number().min(0.75).max(1.5),
      freeCharsPerMonth: z.number().int().min(0).max(10_000_000),
      allowPaid: z.boolean(),
      layout: z.enum(['landscape', 'vertical']),
    })
    .default({
      ttsProvider: 'google',
      googleVoice: 'pt-BR-Chirp3-HD-Puck',
      speakingRate: 1.05,
      freeCharsPerMonth: 1_000_000,
      allowPaid: false,
      layout: 'landscape',
    }),

  /**
   * Produção de vídeos (Fase 3). Modelos do roteirista e do revisor visual (custo por vídeo),
   * duração-alvo e voltas máximas do Revisor.
   */
  production: z
    .object({
      writerModel: z.enum(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5']),
      reviewerModel: z.enum(['claude-sonnet-5-5', 'claude-opus-5-5']),
      longTargetSec: z.number().int().min(90).max(600),
      shortTargetSec: z.number().int().min(20).max(58),
      maxReviewRounds: z.number().int().min(1).max(3),
    })
    .default({
      writerModel: 'claude-sonnet-5-5',
      reviewerModel: 'claude-sonnet-5-5',
      longTargetSec: 210,
      shortTargetSec: 45,
      maxReviewRounds: 3,
    }),

  /**
   * Imagens geradas (Fase 3): Google (Imagen 4 / Gemini "Nano Banana") ou falsas (teste).
   * Com o modo simulado ligado, as imagens são falsas. O modelo vem da lista da API
   * (`make imagens`); o guia de estilo entra em todo pedido.
   */
  images: z
    .object({
      provider: z.enum(['google', 'fake']),
      model: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,80}$/),
      maxPerLong: z.number().int().min(0).max(20),
      maxPerShort: z.number().int().min(0).max(8),
      style: z.string().min(10).max(600),
    })
    .default({
      provider: 'google',
      model: 'imagen-4.0-fast-generate-001',
      maxPerLong: 6,
      maxPerShort: 2,
      style:
        'Editorial digital illustration, neon synthwave palette (magenta, cyan, sunset orange), ' +
        'Miami-style tropical city at dusk, cinematic lighting, clean composition with empty ' +
        'space for captions. No text, no logos, no watermarks, no real people, no copyrighted characters.',
    }),

  antiSpoiler: z
    .object({
      launchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      windowDays: z.number().int().min(0).max(365),
    })
    .default({ launchDate: '2026-11-19', windowDays: 30 }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]>;
export type SettingsMap = { [K in SettingKey]: SettingValue<K> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SETTINGS, key);
}

export function defaultSetting<K extends SettingKey>(key: K): SettingValue<K> {
  return SETTINGS[key].parse(undefined) as SettingValue<K>;
}

/** Valida um valor; lança erro se inválido. */
export function parseSetting<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  return SETTINGS[key].parse(value) as SettingValue<K>;
}

/** Lê um valor do banco; se inválido, devolve o padrão. */
export function coerceSetting<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  const r = SETTINGS[key].safeParse(value);
  return (r.success ? r.data : defaultSetting(key)) as SettingValue<K>;
}

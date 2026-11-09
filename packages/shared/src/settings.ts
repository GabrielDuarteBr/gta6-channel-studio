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

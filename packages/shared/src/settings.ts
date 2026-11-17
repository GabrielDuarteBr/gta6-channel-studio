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

  /** Teto de gasto com APIs, em reais (convertido pela cotação de `currency`). Pausa os agentes. */
  budget: z
    .object({
      monthlyBrl: z.number().min(0).max(100_000),
      dailyBrl: z.number().min(0).max(10_000),
    })
    .default({ monthlyBrl: 150, dailyBrl: 5 }),

  /**
   * Conversão dólar → real: PTAX de venda do Banco Central (buscada pelo agents) ou cotação fixa,
   * mais spread do banco e IOF de compra internacional no cartão.
   */
  currency: z
    .object({
      source: z.enum(['bcb', 'manual']),
      manualRate: z.number().min(1).max(30),
      iofPercent: z.number().min(0).max(20),
      spreadPercent: z.number().min(0).max(20),
    })
    .default({ source: 'bcb', manualRate: 5.56, iofPercent: 3.5, spreadPercent: 4 }),

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

  /**
   * Parceiros (Fase 4). Caçador: busca semanal no YouTube (só metadados, 1 busca por termo) e
   * triagem com o Claude Haiku; cria candidatos com rascunho de mensagem (nunca envia).
   * Arquivos: tamanho e duração máximos aceitos na importação.
   */
  partners: z
    .object({
      huntWeekly: z.boolean(),
      huntQueries: z.array(z.string().min(2).max(60)).min(1).max(3),
      huntMaxChannels: z.number().int().min(5).max(50),
      minSubscribers: z.number().int().min(0).max(10_000_000),
      maxImportMb: z.number().int().min(20).max(2000),
      maxClipMinutes: z.number().int().min(1).max(60),
    })
    .default({
      huntWeekly: true,
      huntQueries: ['GTA 6 gameplay', 'GTA VI notícias'],
      huntMaxChannels: 15,
      minSubscribers: 1000,
      maxImportMb: 1024,
      maxClipMinutes: 20,
    }),

  /**
   * Short de react (Fase 4). O clipe nunca passa de 50% (regra 3); aqui só dá para apertar.
   * Comentarista e Cortador: modelos e duração-alvo; layouts que entram no rodízio.
   */
  react: z
    .object({
      targetSec: z.number().int().min(20).max(58),
      maxClipRatio: z.number().min(0.2).max(0.5),
      commentatorModel: z.enum(['claude-sonnet-5-5', 'claude-opus-5-5']),
      layouts: z.array(z.enum(['tv', 'split', 'cinema'])).min(1),
    })
    .default({
      targetSec: 40,
      maxClipRatio: 0.45,
      commentatorModel: 'claude-sonnet-5-5',
      layouts: ['tv', 'split', 'cinema'],
    }),

  /**
   * Publicação no YouTube (Fase 5). Tudo sobe PRIVADO com data marcada; o horário padrão sai dos
   * horários de publicação (Brasília). Categoria 20 = Jogos.
   */
  youtube: z
    .object({
      categoryId: z.string().regex(/^\d{1,3}$/),
      defaultTags: z.array(z.string().min(2).max(40)).max(15),
      publishTimes: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)).min(1).max(6),
      notifySubscribers: z.boolean(),
    })
    .default({
      categoryId: '20',
      defaultTags: ['GTA 6', 'GTA VI', 'Grand Theft Auto VI', 'Radar Neon', 'notícias de games'],
      publishTimes: ['12:00', '18:00', '20:30'],
      notifySubscribers: true,
    }),

  /**
   * Produção diária automática (Fase 7): no horário marcado o estúdio escolhe as melhores
   * histórias (e um vídeo de parceiro, se houver) e produz até o limite do dia. Tudo vai para a
   * fila de Aprovação — nada sobe sem o dono (a não ser com o piloto automático ligado).
   */
  'schedule.daily': z
    .object({
      enabled: z.boolean(),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      long: z.number().int().min(0).max(5),
      newsShorts: z.number().int().min(0).max(10),
      reacts: z.number().int().min(0).max(5),
    })
    .default({ enabled: true, time: '07:41', long: 1, newsShorts: 3, reacts: 1 }),
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

import { getAllSettings, type PrismaClient } from '@studio/db';
import { assertWithinBudget } from '@studio/llm';
import {
  CHIRP3_HD_USD_PER_MILLION,
  createTtsProvider,
  ProviderError,
  type TtsProvider,
  type TtsProviderId,
} from '@studio/providers';
import { channelDay, channelMonth } from '@studio/shared';
import { budgetStatus } from '../research/ledger';

/** Para antes do fim da cota grátis (margem para contagens diferentes da do Google). */
export const FREE_TIER_MARGIN = 0.95;

export class TtsQuotaError extends ProviderError {
  override name = 'TtsQuotaError';
}

/** Caracteres de voz do Google já gastos neste mês (cache não conta). */
export async function googleCharsThisMonth(prisma: PrismaClient): Promise<number> {
  const agg = await prisma.costLedger.aggregate({
    _sum: { characters: true },
    where: {
      provider: 'tts',
      model: { startsWith: 'google:' },
      dayKey: { startsWith: channelMonth() },
    },
  });
  return agg._sum.characters ?? 0;
}

/** Quanto custa, de verdade, gastar `chars` agora (só o que passar da cota grátis paga). */
export function paidCostUsd(usedBefore: number, chars: number, freeChars: number): number {
  const paidChars =
    Math.max(0, usedBefore + chars - freeChars) - Math.max(0, usedBefore - freeChars);
  return (paidChars * CHIRP3_HD_USD_PER_MILLION) / 1_000_000;
}

/**
 * Escolhe a voz do clipe. Modo simulado = voz de teste, a não ser que o dono peça outra
 * explicitamente no clipe (`override`).
 */
export async function ttsForClip(
  prisma: PrismaClient,
  opts: { mediaUrl: string; googleApiKey?: string | undefined; override?: TtsProviderId },
): Promise<TtsProvider> {
  const settings = await getAllSettings(prisma);
  const c = settings.character;
  const id: TtsProviderId = opts.override ?? (settings['mode.simulation'] ? 'fake' : c.ttsProvider);
  return createTtsProvider(id, {
    mediaUrl: opts.mediaUrl,
    google: {
      apiKey: opts.googleApiKey,
      voice: c.googleVoice,
      speakingRate: c.speakingRate,
      guard: async (chars) => {
        const used = await googleCharsThisMonth(prisma);
        const limit = Math.floor(c.freeCharsPerMonth * FREE_TIER_MARGIN);
        if (!c.allowPaid && used + chars > limit) {
          throw new TtsQuotaError(
            `cota grátis da voz do Google quase no fim (${used.toLocaleString('pt-BR')} de ` +
              `${c.freeCharsPerMonth.toLocaleString('pt-BR')} caracteres neste mês). Libere ` +
              '"permitir pagar além da cota" em Configurações ou espere o mês virar.',
          );
        }
        const cost = paidCostUsd(used, chars, c.freeCharsPerMonth);
        if (cost > 0) {
          // Confere o teto como se este gasto já tivesse acontecido.
          const b = await budgetStatus(prisma);
          assertWithinBudget({
            ...b,
            spentTodayUsd: b.spentTodayUsd + cost,
            spentMonthUsd: b.spentMonthUsd + cost,
          });
        }
      },
    },
  });
}

/** Registra no ledger um trecho de voz gerado (cache não gasta e não entra). */
export async function recordTts(
  prisma: PrismaClient,
  tts: TtsProvider,
  r: { chars: number; cached?: boolean | undefined },
  task: string,
  voiceLabel?: string,
): Promise<number> {
  if (r.cached) return 0;
  let costUsd = 0;
  if (tts.id === 'google') {
    const settings = await getAllSettings(prisma);
    costUsd = paidCostUsd(
      await googleCharsThisMonth(prisma),
      r.chars,
      settings.character.freeCharsPerMonth,
    );
  }
  await prisma.costLedger.create({
    data: {
      dayKey: channelDay(),
      provider: 'tts',
      model: tts.id === 'google' ? `google:${voiceLabel ?? 'voz'}` : tts.id,
      task,
      characters: r.chars,
      costUsd,
      simulated: !tts.real,
    },
  });
  return costUsd;
}

import { effectiveBrlPerUsd, FALLBACK_BRL_PER_USD, formatBrl, usdToBrl } from '@studio/shared';
import type { PrismaClient } from './generated/prisma/client';
import { getAllSettings } from './settings';

/** Cotação em uso para converter dólar → real (painel, teto de gasto, relatórios). */
export interface CurrentFx {
  /** Reais por dólar (PTAX de venda ou cotação fixa). */
  rate: number;
  /** Reais por dólar com spread e IOF (o que a fatura do cartão cobra). */
  effective: number;
  iofPercent: number;
  spreadPercent: number;
  /** "bcb-ptax" | "manual" | "reserva" (ainda sem cotação do BCB). */
  source: 'bcb-ptax' | 'manual' | 'reserva';
  /** AAAA-MM-DD da cotação (null na fixa). */
  day: string | null;
  usdToBrl(usd: number): number;
  formatUsd(usd: number): string;
}

export async function currentFx(prisma: PrismaClient): Promise<CurrentFx> {
  const { currency } = await getAllSettings(prisma);
  let rate = currency.manualRate;
  let source: CurrentFx['source'] = 'manual';
  let day: string | null = null;
  if (currency.source === 'bcb') {
    const last = await prisma.fxRate.findFirst({ orderBy: { day: 'desc' } });
    if (last) {
      rate = Number(last.rate);
      source = 'bcb-ptax';
      day = last.day;
    } else {
      rate = FALLBACK_BRL_PER_USD;
      source = 'reserva';
    }
  }
  const costs = { rate, iofPercent: currency.iofPercent, spreadPercent: currency.spreadPercent };
  return {
    ...costs,
    effective: effectiveBrlPerUsd(costs),
    source,
    day,
    usdToBrl: (usd) => usdToBrl(usd, costs),
    formatUsd: (usd) => formatBrl(usdToBrl(usd, costs)),
  };
}

/** Grava a cotação de um dia (idempotente: a mesma data só atualiza o valor). */
export async function saveFxRate(
  prisma: PrismaClient,
  day: string,
  rate: number,
  source = 'bcb-ptax',
): Promise<void> {
  await prisma.fxRate.upsert({
    where: { day },
    create: { day, rate, source },
    update: { rate, source, fetchedAt: new Date() },
  });
}

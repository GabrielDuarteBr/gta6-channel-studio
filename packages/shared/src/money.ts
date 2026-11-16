/**
 * Valores em reais. As APIs cobram em dólar; o estúdio converte pela cotação PTAX do Banco
 * Central (ou uma fixa, em Configurações) e soma o que o cartão cobra por cima: spread do banco
 * sobre o câmbio e IOF de compra internacional (3,5% desde jul/2025), que incide sobre o valor
 * já convertido. O teto de gasto e todos os valores do painel ficam em R$.
 */

/** Cotação de reserva (PTAX de venda de 11/11/2026), usada até a primeira busca no BCB. */
export const FALLBACK_BRL_PER_USD = 5.5606;

export interface FxCosts {
  /** Reais por dólar (PTAX de venda ou cotação fixa). */
  rate: number;
  iofPercent: number;
  spreadPercent: number;
}

/** Reais por dólar já com spread e IOF (o que aparece na fatura do cartão). */
export function effectiveBrlPerUsd(fx: FxCosts): number {
  return fx.rate * (1 + fx.spreadPercent / 100) * (1 + fx.iofPercent / 100);
}

export function usdToBrl(usd: number, fx: FxCosts): number {
  return usd * effectiveBrlPerUsd(fx);
}

const brl = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const brlFine = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** "R$ 1,23"; valores pequenos (abaixo de R$ 0,10) com 3 casas para não virar "R$ 0,00". */
export function formatBrl(value: number): string {
  const v = Number.isFinite(value) ? value : 0;
  const text = v !== 0 && Math.abs(v) < 0.1 ? brlFine.format(v) : brl.format(v);
  return text.replace(/\u00a0/g, ' ');
}

/** Cotação com 4 casas, como o Banco Central publica ("R$ 5,5606"). */
export function formatBrlRate(rate: number): string {
  return `R$ ${rate.toFixed(4).replace('.', ',')}`;
}

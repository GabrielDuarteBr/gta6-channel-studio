import { saveFxRate, type PrismaClient } from '@studio/db';
import type { Logger } from '@studio/shared';
import { z } from 'zod';

/**
 * Cotação do dólar (PTAX de venda) do Banco Central, pela API pública Olinda (sem chave):
 * CotacaoDolarPeriodo entre 10 dias atrás e hoje; vale a última cotação do período (fim de
 * semana e feriado não têm boletim). Falhou? Fica a última cotação salva.
 */
export const FX_JOB = 'fx.update';
export const BCB_PTAX_URL =
  'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const ptaxSchema = z.object({
  value: z.array(
    z.object({
      cotacaoCompra: z.number(),
      cotacaoVenda: z.number(),
      dataHoraCotacao: z.string(),
    }),
  ),
});

/** MM-DD-AAAA, o formato que a API do BCB pede. */
function bcbDate(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('month')}-${get('day')}-${get('year')}`;
}

export function ptaxUrl(now: Date): string {
  const start = new Date(now.getTime() - 10 * 86_400_000);
  const qs = [
    `@dataInicial='${bcbDate(start)}'`,
    `@dataFinalCotacao='${bcbDate(now)}'`,
    '$format=json',
    '$select=cotacaoCompra,cotacaoVenda,dataHoraCotacao',
  ].join('&');
  return `${BCB_PTAX_URL}?${qs}`;
}

export interface PtaxQuote {
  day: string;
  rate: number;
}

export async function fetchPtax(
  fetchImpl: FetchLike = fetch,
  now = new Date(),
): Promise<PtaxQuote> {
  const res = await fetchImpl(ptaxUrl(now), {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Banco Central respondeu HTTP ${res.status}`);
  const data = ptaxSchema.parse(await res.json());
  const last = [...data.value]
    .sort((a, b) => a.dataHoraCotacao.localeCompare(b.dataHoraCotacao))
    .at(-1);
  if (!last) throw new Error('Banco Central sem cotação nos últimos 10 dias');
  if (!(last.cotacaoVenda > 1 && last.cotacaoVenda < 30)) {
    throw new Error(`cotação fora do esperado: ${last.cotacaoVenda}`);
  }
  return { day: last.dataHoraCotacao.slice(0, 10), rate: last.cotacaoVenda };
}

export async function runFxUpdate(
  ctx: { prisma: PrismaClient; log: Logger; fetchImpl?: FetchLike },
  now = new Date(),
): Promise<PtaxQuote> {
  const quote = await fetchPtax(ctx.fetchImpl, now);
  await saveFxRate(ctx.prisma, quote.day, quote.rate);
  ctx.log.info(quote, 'cotação do dólar atualizada (PTAX)');
  return quote;
}

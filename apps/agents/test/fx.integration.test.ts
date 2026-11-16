import { createPrisma, currentFx, setSetting } from '@studio/db';
import { assertWithinBudget, BudgetExceededError } from '@studio/llm';
import { channelDay, createLogger } from '@studio/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { fetchPtax, ptaxUrl, runFxUpdate } from '../src/fx';
import { budgetStatus } from '../src/research/ledger';

const PTAX = {
  '@odata.context': 'https://olinda.bcb.gov.br/...$metadata#_CotacaoDolarPeriodo',
  value: [
    { cotacaoCompra: 5.5007, cotacaoVenda: 5.5013, dataHoraCotacao: '2026-11-06 13:05:21.101' },
    { cotacaoCompra: 5.56, cotacaoVenda: 5.5606, dataHoraCotacao: '2026-11-11 13:04:25.633' },
    { cotacaoCompra: 5.514, cotacaoVenda: 5.5146, dataHoraCotacao: '2026-11-09 13:02:11.020' },
  ],
};

describe('cotação PTAX do Banco Central', () => {
  it('pede os últimos 10 dias no formato da API e pega a última cotação de venda', async () => {
    const now = new Date('2026-11-16T15:00:00Z');
    expect(ptaxUrl(now)).toContain("@dataInicial='11-06-2026'&@dataFinalCotacao='11-16-2026'");
    let asked = '';
    const q = await fetchPtax(async (u) => {
      asked = u;
      return new Response(JSON.stringify(PTAX));
    }, now);
    expect(asked).toMatch(/^https:\/\/olinda\.bcb\.gov\.br\/olinda\/servico\/PTAX\//);
    expect(q).toEqual({ day: '2026-11-11', rate: 5.5606 });
  });

  it('erro do BCB, lista vazia ou valor absurdo não viram cotação', async () => {
    await expect(fetchPtax(async () => new Response('x', { status: 503 }))).rejects.toThrow(/503/);
    await expect(
      fetchPtax(async () => new Response(JSON.stringify({ value: [] }))),
    ).rejects.toThrow(/sem cotação/);
    await expect(
      fetchPtax(
        async () =>
          new Response(
            JSON.stringify({
              value: [{ cotacaoCompra: 0, cotacaoVenda: 0, dataHoraCotacao: '2026-11-11 13:00' }],
            }),
          ),
      ),
    ).rejects.toThrow(/fora do esperado/);
  });
});

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('valores e teto em reais', () => {
  const prisma = createPrisma(url as string);
  const log = createLogger('teste', 'silent');
  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "FxRate", "Setting", "CostLedger" CASCADE');
  });
  afterAll(() => prisma.$disconnect());

  it('sem cotação ainda: usa a de reserva; depois da busca, a do BCB; fixa se o dono escolher', async () => {
    expect((await currentFx(prisma)).source).toBe('reserva');
    await runFxUpdate({ prisma, log, fetchImpl: async () => new Response(JSON.stringify(PTAX)) });
    const fx = await currentFx(prisma);
    expect(fx).toMatchObject({ source: 'bcb-ptax', day: '2026-11-11', rate: 5.5606 });
    expect(fx.effective).toBeCloseTo(5.5606 * 1.04 * 1.035, 6);
    expect(fx.formatUsd(1)).toBe('R$ 5,99');
    await setSetting(
      prisma,
      'currency',
      { source: 'manual', manualRate: 5, iofPercent: 0, spreadPercent: 0 },
      'owner',
    );
    expect(await currentFx(prisma)).toMatchObject({ source: 'manual', rate: 5, effective: 5 });
  });

  it('teto de R$ 5 por dia: gasto em dólar convertido, mensagem em reais', async () => {
    await setSetting(
      prisma,
      'currency',
      { source: 'manual', manualRate: 5, iofPercent: 0, spreadPercent: 0 },
      'owner',
    );
    await setSetting(prisma, 'budget', { monthlyBrl: 150, dailyBrl: 5 }, 'owner');
    await prisma.costLedger.create({
      data: { dayKey: channelDay(), provider: 'anthropic', task: 't', costUsd: 0.5 },
    });
    const b = await budgetStatus(prisma);
    expect(b.dailyLimitUsd).toBeCloseTo(1, 6); // R$ 5 ÷ 5
    expect(b.monthlyLimitUsd).toBeCloseTo(30, 6);
    expect(() => assertWithinBudget(b)).not.toThrow(); // R$ 2,50 de R$ 5
    await prisma.costLedger.create({
      data: { dayKey: channelDay(), provider: 'image', task: 't', costUsd: 0.6 },
    });
    const over = await budgetStatus(prisma);
    expect(() => assertWithinBudget(over)).toThrow(BudgetExceededError);
    expect(() => assertWithinBudget(over)).toThrow(
      'Teto diário de R$ 5,00 atingido (gasto: R$ 5,50).',
    );
  });
});

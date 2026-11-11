import type { PrismaClient } from '@studio/db';
import { getAllSettings } from '@studio/db';
import type { BudgetStatus, LlmCostRecord } from '@studio/llm';
import type { QuotaRecorder } from '@studio/research';
import { channelDay, channelMonth, youtubeQuotaDay } from '@studio/shared';

/** Registra o uso da cota do YouTube por balde, no dia do Pacífico. */
export function quotaRecorder(prisma: PrismaClient, simulated = false): QuotaRecorder {
  return async (bucket, method, units) => {
    await prisma.quotaLedger.create({
      data: { pacificDay: youtubeQuotaDay(), bucket, method, units, simulated },
    });
  };
}

export async function searchCallsToday(prisma: PrismaClient): Promise<number> {
  const agg = await prisma.quotaLedger.aggregate({
    _sum: { units: true },
    where: { pacificDay: youtubeQuotaDay(), bucket: 'search.list' },
  });
  return agg._sum.units ?? 0;
}

/** Gasto real (sem simulado) do dia e do mês, e os tetos das configurações. */
export async function budgetStatus(prisma: PrismaClient): Promise<BudgetStatus> {
  const settings = await getAllSettings(prisma);
  const [today, month] = await Promise.all([
    prisma.costLedger.aggregate({
      _sum: { costUsd: true },
      where: { dayKey: channelDay(), simulated: false },
    }),
    prisma.costLedger.aggregate({
      _sum: { costUsd: true },
      where: { dayKey: { startsWith: channelMonth() }, simulated: false },
    }),
  ]);
  return {
    spentTodayUsd: Number(today._sum.costUsd ?? 0),
    spentMonthUsd: Number(month._sum.costUsd ?? 0),
    dailyLimitUsd: settings.budget.dailyUsd,
    monthlyLimitUsd: settings.budget.monthlyUsd,
  };
}

export function costRecorder(prisma: PrismaClient, provider = 'anthropic') {
  return async (cost: LlmCostRecord) => {
    await prisma.costLedger.create({
      data: {
        dayKey: channelDay(),
        provider,
        model: cost.model,
        task: cost.task,
        inputTokens: cost.usage.input_tokens,
        outputTokens: cost.usage.output_tokens,
        cacheReadTokens: cost.usage.cache_read_input_tokens ?? null,
        cacheWriteTokens: cost.usage.cache_creation_input_tokens ?? null,
        costUsd: cost.costUsd,
        simulated: cost.simulated,
      },
    });
  };
}

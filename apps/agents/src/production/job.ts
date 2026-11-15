import { ScriptMarkupError } from '@studio/avatar';
import { audit } from '@studio/db';
import { BudgetExceededError, LlmRefusalError } from '@studio/llm';
import { PolicyViolation } from '@studio/policy';
import { ScriptValidationError } from '@studio/production';
import { ProviderError } from '@studio/providers';
import { deterministicJobId, UnrecoverableError } from '@studio/queue';
import { ImageError } from '@studio/storage';
import {
  PRODUCTION_JOB,
  productionJobSchema,
  runProduction,
  type ProductionContext,
  type ProductionResult,
} from './pipeline';
import { ScriptRejectedError } from './writer';

/** Id do job: um por produção e por pedido (minuto), para "tentar de novo" criar outro job. */
export function productionJobId(productionId: string, now = new Date()): string {
  return deterministicJobId('render', PRODUCTION_JOB, productionId, now.toISOString().slice(0, 16));
}

/** Falhas que não melhoram tentando de novo (regra, roteiro, chave, teto, recusa). */
export function isPermanent(err: unknown): boolean {
  return (
    err instanceof PolicyViolation ||
    err instanceof ScriptRejectedError ||
    err instanceof ScriptValidationError ||
    err instanceof ScriptMarkupError ||
    err instanceof BudgetExceededError ||
    err instanceof LlmRefusalError ||
    err instanceof ImageError ||
    (err instanceof ProviderError && !err.retryable)
  );
}

export async function runProductionJob(
  ctx: ProductionContext,
  raw: unknown,
  attempt: { made: number; max: number } = { made: 0, max: 1 },
): Promise<ProductionResult> {
  const { productionId, real } = productionJobSchema.parse(raw);
  try {
    return await runProduction(ctx, productionId, real ? { real } : {});
  } catch (err) {
    const permanent = isPermanent(err);
    const last = permanent || attempt.made + 1 >= attempt.max;
    const message = (err as Error).message.slice(0, 600);
    await ctx.prisma.production
      .update({
        where: { id: productionId },
        data: last
          ? { status: 'FAILED', error: message, step: null, finishedAt: new Date() }
          : { error: `${message} (vai tentar de novo)` },
      })
      .catch(() => undefined);
    if (last) {
      await audit(ctx.prisma, {
        actor: 'agent:produtor',
        action: 'production.failed',
        target: productionId,
        outcome: err instanceof PolicyViolation ? 'DENIED' : 'ERROR',
        details: { reason: message },
      });
    }
    if (permanent) throw new UnrecoverableError(message);
    throw err;
  }
}

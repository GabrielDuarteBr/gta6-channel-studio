import { PolicyViolation } from '@studio/policy';
import { ANALYZE_JOB, deterministicJobId, UnrecoverableError } from '@studio/queue';
import { DownloadError } from './download';
import { huntJobSchema, runHunt, type HuntContext } from './hunter';
import {
  analyzeJobSchema,
  partnerImportJobSchema,
  runAnalyze,
  runPartnerImport,
  type PartnerContext,
} from './import';

/** Jobs de parceiros: falha de regra ou de link não melhora tentando de novo. */
function permanent(err: unknown): boolean {
  return err instanceof PolicyViolation || (err instanceof DownloadError && err.permanent);
}

export async function runPartnerImportJob(ctx: PartnerContext, raw: unknown) {
  const { importId } = partnerImportJobSchema.parse(raw);
  try {
    return await runPartnerImport(ctx, importId);
  } catch (err) {
    if (permanent(err)) throw new UnrecoverableError((err as Error).message);
    throw err;
  }
}

export async function runAnalyzeJob(ctx: PartnerContext, raw: unknown) {
  const { assetId } = analyzeJobSchema.parse(raw);
  return runAnalyze(ctx, assetId);
}

export async function runHuntJob(ctx: HuntContext, raw: unknown) {
  return runHunt(ctx, huntJobSchema.parse(raw ?? {}));
}

export const analyzeJobId = (assetId: string) => deterministicJobId('media', ANALYZE_JOB, assetId);

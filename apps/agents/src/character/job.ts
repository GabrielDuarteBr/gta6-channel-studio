import { createHash } from 'node:crypto';
import { ScriptMarkupError } from '@studio/avatar';
import { getAllSettings, type PrismaClient } from '@studio/db';
import { PolicyViolation } from '@studio/policy';
import { createTtsProvider } from '@studio/providers';
import { deterministicJobId, UnrecoverableError } from '@studio/queue';
import type { Logger } from '@studio/shared';
import { z } from 'zod';
import { CLIP_JOB, produceCharacterClip, type ClipResult } from './clip';
import { MediaService, RenderService } from './services';

export const clipJobSchema = z.object({
  script: z.string().trim().min(2).max(6000),
  layout: z.enum(['landscape', 'vertical']),
  label: z.string().trim().max(80).optional(),
  variant: z
    .string()
    .regex(/^[a-z0-9-]{1,12}$/)
    .optional(),
});
export type ClipJobData = z.infer<typeof clipJobSchema>;

/** Mesmo pedido no mesmo minuto = mesmo job (cliques repetidos não duplicam). */
export function clipJobId(data: ClipJobData, now = new Date()): string {
  const digest = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
  return deterministicJobId('render', CLIP_JOB, digest, now.toISOString().slice(0, 16));
}

export interface ClipJobContext {
  prisma: PrismaClient;
  log: Logger;
  mediaUrl: string;
  renderUrl: string;
}

export async function runClipJob(ctx: ClipJobContext, raw: unknown): Promise<ClipResult> {
  const data = clipJobSchema.parse(raw);
  const settings = await getAllSettings(ctx.prisma);
  try {
    return await produceCharacterClip(
      {
        prisma: ctx.prisma,
        log: ctx.log,
        tts: createTtsProvider(settings.character.ttsProvider, { mediaUrl: ctx.mediaUrl }),
        media: new MediaService(ctx.mediaUrl),
        render: new RenderService(ctx.renderUrl),
      },
      { ...data, label: data.label },
    );
  } catch (err) {
    // Roteiro inválido ou contra a política: tentar de novo não adianta.
    if (err instanceof ScriptMarkupError || err instanceof PolicyViolation) {
      throw new UnrecoverableError(err.message);
    }
    throw err;
  }
}

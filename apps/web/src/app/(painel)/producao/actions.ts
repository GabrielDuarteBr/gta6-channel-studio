'use server';

import { audit, getPrisma } from '@studio/db';
import { PolicyViolation } from '@studio/policy';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { cancelProduction, retryProduction, startProduction } from '@/server/production';
import { requireOwner } from '@/server/session';

export interface ProductionActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const id = z.string().regex(/^[a-z0-9]{8,40}$/);

export async function startProductionAction(
  _prev: ProductionActionState,
  form: FormData,
): Promise<ProductionActionState> {
  await requireOwner();
  const storyId = id.safeParse(form.get('storyId'));
  if (!storyId.success) return { error: 'História inválida.' };
  try {
    await startProduction(storyId.data);
  } catch (err) {
    if (err instanceof PolicyViolation) {
      const reason = err.message.replace(/^\[[A-Z_]+\]\s*/, '');
      await audit(getPrisma(), {
        actor: 'owner',
        action: 'production.start',
        outcome: 'DENIED',
        target: storyId.data,
        details: { reason },
      });
      return { error: reason };
    }
    throw err;
  }
  revalidatePath('/producao');
  return {
    ok: true,
    message: 'Produção na fila. Roteiro, imagens, voz, render e revisão levam alguns minutos.',
  };
}

export async function retryProductionAction(form: FormData): Promise<void> {
  await requireOwner();
  const parsed = id.safeParse(form.get('productionId'));
  if (!parsed.success) return;
  await retryProduction(parsed.data);
  revalidatePath('/producao');
}

export async function cancelProductionAction(form: FormData): Promise<void> {
  await requireOwner();
  const parsed = id.safeParse(form.get('productionId'));
  if (!parsed.success) return;
  await cancelProduction(parsed.data);
  revalidatePath('/producao');
}

'use server';

import { audit, getAllSettings, getPrisma } from '@studio/db';
import { canPromoteStory } from '@studio/policy';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { enqueueManualCollect } from '@/server/research';
import { requireOwner } from '@/server/session';

export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const statusSchema = z.object({
  storyId: z.string().min(1).max(40),
  status: z.enum(['NEW', 'QUEUED_LONG', 'QUEUED_SHORT', 'QUEUED_COMPILATION', 'DISMISSED']),
});

const LABEL: Record<string, string> = {
  NEW: 'voltou para novas',
  QUEUED_LONG: 'vai virar vídeo longo',
  QUEUED_SHORT: 'vai virar Short',
  QUEUED_COMPILATION: 'entrou no compilado',
  DISMISSED: 'descartada',
};

/** Muda o destino de uma história. Promover passa pelas regras (vazamento, rumor, spoiler). */
export async function setStoryStatusAction(
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireOwner();
  const parsed = statusSchema.safeParse({
    storyId: form.get('storyId'),
    status: form.get('status'),
  });
  if (!parsed.success) return { error: 'Pedido inválido.' };
  const { storyId, status } = parsed.data;
  const prisma = getPrisma();
  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) return { error: 'História não encontrada.' };

  if (status.startsWith('QUEUED')) {
    const settings = await getAllSettings(prisma);
    const decision = canPromoteStory(
      {
        flags: story.flags as Record<string, boolean> | null,
        isRumor: story.isRumor,
        independentSources: story.independentSources,
        officialCount: story.officialCount,
      },
      settings.antiSpoiler,
    );
    if (!decision.ok) {
      await audit(prisma, {
        actor: 'owner',
        action: 'story.promote',
        target: storyId,
        outcome: 'DENIED',
        details: { status, reasons: decision.reasons },
      });
      return { error: decision.reasons.join(' ') };
    }
  }

  await prisma.story.update({
    where: { id: storyId },
    data: { status, statusChangedAt: new Date() },
  });
  await audit(prisma, {
    actor: 'owner',
    action: 'story.status',
    target: storyId,
    details: { from: story.status, to: status },
  });
  revalidatePath('/pauta');
  return { ok: true, message: `Pauta ${LABEL[status]}.` };
}

export async function collectNowAction(_prev: ActionState): Promise<ActionState> {
  await requireOwner();
  try {
    await enqueueManualCollect();
    await audit(getPrisma(), { actor: 'owner', action: 'research.collect.manual' });
    return { ok: true, message: 'Coleta enfileirada. Atualize a página em 1–2 minutos.' };
  } catch {
    return { error: 'Não consegui falar com a fila (Redis). Veja a tela Saúde.' };
  }
}

'use server';

import { audit, getPrisma } from '@studio/db';
import { PolicyViolation } from '@studio/policy';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionState } from '@/components/action-form';
import {
  approvePublication,
  cancelPublication,
  markManualUploaded,
  metadataSchema,
  recheckCompliance,
  rejectProduction,
  retryUpload,
  saveMetadata,
} from '@/server/publish';
import { requireOwner } from '@/server/session';

const id = z.string().regex(/^[a-z0-9]{8,40}$/);

/** "2026-11-20T18:00" no horário de Brasília (UTC−3, sem horário de verão). */
function brasilia(value: FormDataEntryValue | null): Date | null {
  const v = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return null;
  const d = new Date(`${v}:00-03:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function failure(err: unknown): ActionState {
  if (err instanceof PolicyViolation) return { error: err.message.replace(/^\[[A-Z_]+\]\s*/, '') };
  if (err instanceof Error) return { error: err.message.slice(0, 300) };
  throw err;
}

function refresh() {
  revalidatePath('/aprovacao');
  revalidatePath('/calendario');
  revalidatePath('/producao');
}

export async function approveAction(_p: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const productionId = id.safeParse(form.get('productionId'));
  const publishAt = brasilia(form.get('publishAt'));
  if (!productionId.success || !publishAt) return { error: 'Data inválida.' };
  try {
    const pub = await approvePublication({ productionId: productionId.data, publishAt });
    refresh();
    return {
      ok: true,
      message:
        pub.mode === 'manual'
          ? 'Aprovado. Sem YouTube conectado: baixe o pacote abaixo e envie pelo YouTube Studio.'
          : pub.simulated
            ? 'Aprovado. Modo simulado: o envio é simulado (nada sai do computador).'
            : 'Aprovado. Vai subir PRIVADO e agendado para a data escolhida.',
    };
  } catch (err) {
    if (err instanceof PolicyViolation) {
      await audit(getPrisma(), {
        actor: 'owner',
        action: 'publish.approve',
        outcome: 'DENIED',
        target: productionId.data,
        details: { rule: err.rule },
      });
    }
    return failure(err);
  }
}

export async function saveMetadataAction(_p: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const productionId = id.safeParse(form.get('productionId'));
  const meta = metadataSchema.safeParse({
    title: form.get('title'),
    description: String(form.get('description') ?? '').replace(/\r\n/g, '\n'),
    tags: String(form.get('tags') ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  });
  if (!productionId.success) return { error: 'Vídeo inválido.' };
  if (!meta.success) {
    return { error: 'Título (3–100), descrição (10–5000) e até 30 tags.' };
  }
  try {
    await saveMetadata(productionId.data, meta.data);
  } catch (err) {
    return failure(err);
  }
  refresh();
  return { ok: true, message: 'Salvo. A Conformidade está conferindo de novo (alguns segundos).' };
}

export async function recheckAction(form: FormData): Promise<void> {
  await requireOwner();
  const productionId = id.safeParse(form.get('productionId'));
  if (!productionId.success) return;
  await recheckCompliance(productionId.data);
  refresh();
}

export async function rejectAction(_p: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const productionId = id.safeParse(form.get('productionId'));
  if (!productionId.success) return { error: 'Vídeo inválido.' };
  await rejectProduction(productionId.data, String(form.get('reason') ?? '').trim());
  refresh();
  return { ok: true, message: 'Rejeitado.' };
}

export async function cancelPublicationAction(
  _p: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireOwner();
  const pubId = id.safeParse(form.get('publicationId'));
  if (!pubId.success) return { error: 'Publicação inválida.' };
  try {
    await cancelPublication(pubId.data);
  } catch (err) {
    return failure(err);
  }
  refresh();
  return { ok: true, message: 'Cancelado.' };
}

export async function retryUploadAction(_p: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const pubId = id.safeParse(form.get('publicationId'));
  if (!pubId.success) return { error: 'Publicação inválida.' };
  try {
    await retryUpload(pubId.data);
  } catch (err) {
    return failure(err);
  }
  refresh();
  return { ok: true, message: 'De volta à fila de envio.' };
}

export async function manualUploadedAction(_p: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const pubId = id.safeParse(form.get('publicationId'));
  if (!pubId.success) return { error: 'Publicação inválida.' };
  try {
    await markManualUploaded(pubId.data, String(form.get('url') ?? ''));
  } catch (err) {
    return failure(err);
  }
  refresh();
  return { ok: true, message: 'Registrado. As métricas desse vídeo passam a contar.' };
}

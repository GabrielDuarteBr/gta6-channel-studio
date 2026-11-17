'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ActionState } from '@/components/action-form';
import { decidePendingAction, sendChat } from '@/server/publish';
import { requireOwner } from '@/server/session';

export async function sendChatAction(_p: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const text = String(form.get('text') ?? '').trim();
  if (text.length < 2) return { error: 'Escreva o pedido.' };
  if (text.length > 2000) return { error: 'Mensagem longa demais (máx. 2000 caracteres).' };
  try {
    await sendChat(text);
  } catch (err) {
    return { error: (err as Error).message };
  }
  return { ok: true, message: String(Date.now()) };
}

export async function decideAction(_p: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const id = z
    .string()
    .regex(/^[a-z0-9]{8,40}$/)
    .safeParse(form.get('actionId'));
  if (!id.success) return { error: 'Pedido inválido.' };
  const confirm = form.get('decision') === 'confirm';
  const status = await decidePendingAction(id.data, confirm);
  revalidatePath('/aprovacao');
  revalidatePath('/calendario');
  if (status === 'EXPIRED') return { error: 'O pedido expirou (mais de 24 h). Peça de novo.' };
  if (confirm && status === 'REJECTED')
    return { error: 'Não deu para aprovar: veja o motivo no pedido.' };
  return { ok: true, message: confirm ? 'Confirmado.' : 'Recusado.' };
}

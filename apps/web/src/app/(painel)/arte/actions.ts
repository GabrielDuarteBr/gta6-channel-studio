'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { approveScenery, discardScenery, requestVariation } from '@/server/art';
import { requireOwner } from '@/server/session';

const id = z.string().regex(/^[a-z0-9]{8,40}$/);

export async function approveAction(form: FormData): Promise<void> {
  await requireOwner();
  const parsed = id.safeParse(form.get('assetId'));
  if (!parsed.success) return;
  await approveScenery(parsed.data, form.get('approved') === 'true');
  revalidatePath('/arte');
}

export async function discardAction(form: FormData): Promise<void> {
  await requireOwner();
  const parsed = id.safeParse(form.get('assetId'));
  if (!parsed.success) return;
  await discardScenery(parsed.data);
  revalidatePath('/arte');
}

export async function variationAction(form: FormData): Promise<void> {
  await requireOwner();
  const parsed = id.safeParse(form.get('assetId'));
  if (!parsed.success) return;
  await requestVariation(parsed.data);
  revalidatePath('/arte');
}

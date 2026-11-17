'use server';

import { PolicyViolation } from '@studio/policy';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  importFromLink,
  registerPermission,
  requestHunt,
  setAudioCleared,
  setPermissionStatus,
  setStage,
  startReact,
  type AffectedProduction,
} from '@/server/partners';
import { requireOwner } from '@/server/session';

export interface PartnerActionState {
  ok?: boolean;
  message?: string;
  error?: string;
  affected?: AffectedProduction[];
}

function explain(err: unknown): string {
  if (err instanceof PolicyViolation) return err.message.replace(/^\[[A-Z_]+\]\s*/, '');
  if (err instanceof Error && !/prisma|ECONN|redis/i.test(err.message)) return err.message;
  return 'Algo deu errado. Veja Saúde e custos.';
}

const id = z.string().regex(/^[a-z0-9]{8,40}$/);

export async function huntAction(): Promise<PartnerActionState> {
  await requireOwner();
  await requestHunt();
  revalidatePath('/parceiros');
  return {
    ok: true,
    message: 'Caçador na fila: os candidatos aparecem aqui em alguns segundos (recarregue).',
  };
}

export async function addChannelAction(
  _prev: PartnerActionState,
  form: FormData,
): Promise<PartnerActionState> {
  await requireOwner();
  const url = String(form.get('channelUrl') ?? '').trim();
  if (!/^(https:\/\/(www\.|m\.)?youtube\.com\/(@|channel\/)|@)[A-Za-z0-9._-]/.test(url)) {
    return { error: 'Cole o link do canal: youtube.com/@canal ou youtube.com/channel/UC...' };
  }
  await requestHunt(url);
  revalidatePath('/parceiros');
  return {
    ok: true,
    message: 'Canal na fila: a ficha e o rascunho da mensagem aparecem em instantes.',
  };
}

const stageSchema = z.object({
  partnerId: id,
  stage: z.enum(['CANDIDATE', 'CONTACTED', 'DISMISSED']),
});

export async function stageAction(form: FormData): Promise<void> {
  await requireOwner();
  const p = stageSchema.safeParse({ partnerId: form.get('partnerId'), stage: form.get('stage') });
  if (!p.success) return;
  await setStage(p.data.partnerId, p.data.stage);
  revalidatePath('/parceiros');
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const permissionSchema = z.object({
  partnerId: id,
  proofKind: z.enum(['EMAIL', 'DIRECT_MESSAGE', 'CONTRACT', 'OTHER']),
  proof: z.string().trim().max(3000),
  grantedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Informe a data da permissão.'),
  expiresAt: z
    .string()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/)
    .transform((v) => v || null),
  credit: z.string().trim().max(60),
  link: optional(300),
  hashtag: optional(42),
  monetization: z.enum(['allowed', 'not_allowed']),
  maxClipSec: z
    .string()
    .trim()
    .transform((v) => (v ? Number(v) : null))
    .refine((v) => v === null || Number.isFinite(v), 'Teto de clipe inválido.'),
  notes: optional(500),
  explicit: z.boolean(),
});

export async function permissionAction(
  _prev: PartnerActionState,
  form: FormData,
): Promise<PartnerActionState> {
  await requireOwner();
  const p = permissionSchema.safeParse({
    partnerId: form.get('partnerId'),
    proofKind: form.get('proofKind'),
    proof: form.get('proof') ?? '',
    grantedAt: form.get('grantedAt') ?? '',
    expiresAt: form.get('expiresAt') ?? '',
    credit: form.get('credit') ?? '',
    link: form.get('link') ?? '',
    hashtag: form.get('hashtag') ?? '',
    monetization: form.get('monetization'),
    maxClipSec: form.get('maxClipSec') ?? '',
    notes: form.get('notes') ?? '',
    explicit: form.get('explicit') === 'on',
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Confira os campos.' };
  const file = form.get('proofFile');
  const proofFile =
    file instanceof File && file.size > 0
      ? { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type }
      : null;
  try {
    await registerPermission({
      partnerId: p.data.partnerId,
      proofKind: p.data.proofKind,
      proof: p.data.proof,
      proofFile,
      grantedAt: new Date(`${p.data.grantedAt}T12:00:00-03:00`),
      expiresAt: p.data.expiresAt ? new Date(`${p.data.expiresAt}T23:59:59-03:00`) : null,
      conditions: {
        credit: p.data.credit,
        link: p.data.link,
        hashtag: p.data.hashtag,
        monetization: p.data.monetization,
        maxClipSec: p.data.maxClipSec,
        notes: p.data.notes,
      },
      explicitConfirmation: p.data.explicit,
    });
  } catch (err) {
    return { error: explain(err) };
  }
  revalidatePath('/parceiros');
  return { ok: true, message: 'Permissão registrada. Agora dá para importar os arquivos.' };
}

const statusSchema = z.object({
  permissionId: id,
  status: z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']),
  reason: z.string().trim().max(500),
});

export async function permissionStatusAction(
  _prev: PartnerActionState,
  form: FormData,
): Promise<PartnerActionState> {
  await requireOwner();
  const p = statusSchema.safeParse({
    permissionId: form.get('permissionId'),
    status: form.get('status'),
    reason: form.get('reason') ?? '',
  });
  if (!p.success) return { error: 'Pedido inválido.' };
  if (p.data.status === 'REVOKED' && p.data.reason.length < 3) {
    return { error: 'Diga o motivo da revogação (fica na auditoria).' };
  }
  try {
    const affected = await setPermissionStatus(p.data.permissionId, p.data.status, p.data.reason);
    revalidatePath('/parceiros');
    const label =
      p.data.status === 'REVOKED'
        ? 'revogada'
        : p.data.status === 'SUSPENDED'
          ? 'suspensa'
          : 'reativada';
    return {
      ok: true,
      message: `Permissão ${label}. ${affected.length ? `${affected.length} vídeo(s) usaram arquivos dela:` : 'Nenhum vídeo usou arquivos dela.'}`,
      affected,
    };
  } catch (err) {
    return { error: explain(err) };
  }
}

const importSchema = z.object({
  partnerId: id,
  permissionId: id,
  url: z.string().trim().min(10, 'Cole o link do Dropbox ou do Google Drive.').max(1000),
  title: optional(140),
});

export async function importLinkAction(
  _prev: PartnerActionState,
  form: FormData,
): Promise<PartnerActionState> {
  await requireOwner();
  const p = importSchema.safeParse({
    partnerId: form.get('partnerId'),
    permissionId: form.get('permissionId'),
    url: form.get('url') ?? '',
    title: form.get('title') ?? '',
  });
  if (!p.success) return { error: p.error.issues[0]?.message ?? 'Confira os campos.' };
  try {
    await importFromLink(p.data);
  } catch (err) {
    return { error: explain(err) };
  }
  revalidatePath('/parceiros');
  return { ok: true, message: 'Importação na fila: baixando e conferindo os vídeos.' };
}

export async function audioAction(form: FormData): Promise<void> {
  await requireOwner();
  const assetId = id.safeParse(form.get('assetId'));
  if (!assetId.success) return;
  await setAudioCleared(assetId.data, form.get('cleared') === 'on');
  revalidatePath('/parceiros');
}

export async function reactAction(
  _prev: PartnerActionState,
  form: FormData,
): Promise<PartnerActionState> {
  await requireOwner();
  const assetId = id.safeParse(form.get('assetId'));
  if (!assetId.success) return { error: 'Arquivo inválido.' };
  try {
    await startReact(assetId.data);
  } catch (err) {
    return { error: explain(err) };
  }
  revalidatePath('/parceiros');
  revalidatePath('/producao');
  return { ok: true, message: 'Short de react na fila. Acompanhe em Produção.' };
}

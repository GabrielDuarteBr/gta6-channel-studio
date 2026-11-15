'use server';

import { LOCKED_RULES, parseScript, ScriptMarkupError } from '@studio/avatar';
import { activeBible, audit, getPrisma, saveBibleVersion } from '@studio/db';
import { claimsToBeHuman } from '@studio/policy';
import { revalidatePath } from 'next/cache';
import { z, ZodError } from 'zod';
import { enqueueClip } from '@/server/character';
import { requireOwner } from '@/server/session';

export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const clipSchema = z.object({
  script: z.string().trim().min(2, 'Escreva o que o Zeca vai falar.').max(6000),
  layout: z.enum(['landscape', 'vertical']),
  tts: z.enum(['fake', 'google']),
});

/** Valida o roteiro aqui (marcações e regra 7) e manda o clipe para a fila. */
export async function generateClipAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const parsed = clipSchema.safeParse({
    script: form.get('script'),
    layout: form.get('layout'),
    tts: form.get('tts') ?? 'fake',
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Roteiro inválido.' };
  try {
    const script = parseScript(parsed.data.script);
    if (claimsToBeHuman(script.spokenText)) {
      await audit(getPrisma(), {
        actor: 'owner',
        action: 'character.clip',
        outcome: 'DENIED',
        details: { reason: 'regra 7: personagem dizendo que é humano' },
      });
      return {
        error:
          'O Zeca não pode dizer que é humano (nem negar que é IA). Ele é um personagem animado.',
      };
    }
  } catch (err) {
    if (err instanceof ScriptMarkupError) return { error: err.message };
    throw err;
  }
  await enqueueClip(parsed.data);
  await audit(getPrisma(), {
    actor: 'owner',
    action: 'character.clip.enqueue',
    details: { layout: parsed.data.layout, tts: parsed.data.tts, chars: parsed.data.script.length },
  });
  revalidatePath('/personagem');
  return {
    ok: true,
    message: 'Clipe na fila. Voz e render levam de 1 a 3 minutos; atualize a página.',
  };
}

const FIELD_LABEL: Record<string, string> = {
  summary: 'Resumo',
  personality: 'Personalidade',
  look: 'Visual',
  voice: 'Voz',
  rules: 'Regras',
  aiDisclosure: 'Aviso de IA',
};

const lines = (form: FormData, name: string) =>
  String(form.get(name) ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

/** Cada salvamento cria uma versão nova da bíblia (auditada). As regras fixas sempre ficam. */
export async function saveBibleAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireOwner();
  const prisma = getPrisma();
  const current = (await activeBible(prisma)).content;
  const locked: readonly string[] = LOCKED_RULES;
  const content = {
    ...current,
    summary: String(form.get('summary') ?? '').trim(),
    personality: lines(form, 'personality'),
    look: lines(form, 'look'),
    voice: {
      tone: String(form.get('tone') ?? '').trim(),
      pace: String(form.get('pace') ?? '').trim(),
      catchphrases: lines(form, 'catchphrases'),
      avoid: lines(form, 'avoid'),
    },
    rules: [...LOCKED_RULES, ...lines(form, 'rules').filter((r) => !locked.includes(r))],
    aiDisclosure: String(form.get('aiDisclosure') ?? '').trim(),
  };
  const note = String(form.get('note') ?? '').trim() || undefined;
  try {
    const version = await saveBibleVersion(prisma, content, 'owner', note);
    revalidatePath('/personagem');
    return { ok: true, message: `Bíblia salva como versão ${version}.` };
  } catch (err) {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      const field = FIELD_LABEL[String(issue?.path[0] ?? '')] ?? 'Campo';
      return { error: `${field}: ${issue?.message ?? 'valor inválido'}` };
    }
    if (err instanceof Error && err.message.includes('regras fixas')) return { error: err.message };
    throw err;
  }
}

/** Restaurar = criar uma versão nova com o conteúdo de uma antiga (nada é apagado). */
export async function restoreBibleAction(form: FormData): Promise<void> {
  await requireOwner();
  const version = z.coerce.number().int().positive().parse(form.get('version'));
  const prisma = getPrisma();
  const row = await prisma.characterBible.findUnique({ where: { version } });
  if (!row) return;
  await saveBibleVersion(prisma, row.content, 'owner', `restaurada da versão ${version}`);
  revalidatePath('/personagem');
}

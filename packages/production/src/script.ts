import { EXPRESSIONS, parseScript, ScriptMarkupError } from '@studio/avatar';
import { LINE_KINDS, type ScriptLineForCheck } from '@studio/policy';
import { z } from 'zod';

/**
 * Roteiro de um vídeo de notícia (saída do Roteirista). Dois schemas:
 * - `writerOutputSchema`: o que o Claude devolve (saída estruturada; sem limites de tamanho,
 *   que a saída estruturada não garante — os limites vão como orientação no .describe);
 * - `videoScriptSchema`: o roteiro validado de verdade (limites, cenas, falas), usado pelo resto.
 */

export const FORMATS = ['LONG', 'SHORT'] as const;
export type VideoFormat = (typeof FORMATS)[number];

/** Palavras por segundo da narração (Chirp 3 HD em ~1,05x fica perto de 2,6). */
export const WORDS_PER_SECOND = 2.6;

export const writerOutputSchema = z.object({
  title: z
    .string()
    .describe('Título do vídeo no YouTube, PT-BR, até 90 caracteres, sem clickbait mentiroso'),
  description: z
    .string()
    .describe(
      'Descrição curta (2 a 4 frases) em PT-BR. As fontes e avisos são acrescentados pelo sistema.',
    ),
  thumbnailTexts: z
    .array(z.string())
    .describe(
      'Exatamente 3 opções de texto para a thumbnail, cada uma com até 26 caracteres, em CAIXA ALTA',
    ),
  thumbnailExpression: z.enum(EXPRESSIONS),
  scenes: z
    .array(
      z.object({
        id: z.number().int().describe('1, 2, 3... na ordem'),
        visual: z
          .enum(['biblioteca', 'gerar', 'zeca'])
          .describe(
            'biblioteca = usar a mídia libraryAssetId; gerar = imagem original nova; zeca = só o Zeca em tela',
          ),
        libraryAssetId: z
          .string()
          .nullable()
          .describe('id da mídia da Biblioteca, quando visual = biblioteca'),
        imagePrompt: z
          .string()
          .nullable()
          .describe(
            'Quando visual = gerar: descrição da imagem EM INGLÊS, sem marcas, personagens ou lugares do jogo, sem texto e sem pessoas reais',
          ),
        headline: z
          .string()
          .nullable()
          .describe('Título curto na tela no começo da cena (até 40 caracteres) ou null'),
      }),
    )
    .describe('Cenas visuais, na ordem. Cada fala aponta para uma cena.'),
  lines: z
    .array(
      z.object({
        id: z.number().int().describe('1, 2, 3... na ordem'),
        scene: z
          .number()
          .int()
          .describe('id da cena em que esta fala acontece (não diminui ao longo do roteiro)'),
        kind: z.enum(LINE_KINDS),
        text: z
          .string()
          .describe(
            'Fala do Zeca em PT-BR, com marcações opcionais [feliz] [surpreso] [serio] [debochado] [bravo] [neutro] [aponta_tela] [aceno] [pausa]',
          ),
        sourceIds: z
          .array(z.string())
          .describe(
            'ids das fontes (lista de fontes da história) que sustentam esta fala; vazio só para abertura/opinião/chamada',
          ),
      }),
    )
    .describe('Falas na ordem em que o Zeca fala'),
});
export type WriterOutput = z.infer<typeof writerOutputSchema>;

const sceneSchema = z
  .object({
    id: z.number().int().min(1),
    visual: z.enum(['biblioteca', 'gerar', 'zeca']),
    libraryAssetId: z.string().min(1).nullable(),
    imagePrompt: z.string().min(12).max(700).nullable(),
    headline: z.string().max(40).nullable(),
  })
  .superRefine((s, ctx) => {
    if (s.visual === 'biblioteca' && !s.libraryAssetId) {
      ctx.addIssue({ code: 'custom', message: `cena ${s.id}: falta libraryAssetId` });
    }
    if (s.visual === 'gerar' && !s.imagePrompt) {
      ctx.addIssue({ code: 'custom', message: `cena ${s.id}: falta imagePrompt` });
    }
  });

const lineSchema = z.object({
  id: z.number().int().min(1),
  scene: z.number().int().min(1),
  kind: z.enum(LINE_KINDS),
  text: z.string().min(2).max(600),
  sourceIds: z.array(z.string()).max(6),
});

export const videoScriptSchema = z
  .object({
    format: z.enum(FORMATS),
    title: z.string().min(8).max(100),
    description: z.string().min(10).max(1500),
    thumbnailTexts: z.array(z.string().min(2).max(30)).length(3),
    thumbnailExpression: z.enum(EXPRESSIONS),
    scenes: z.array(sceneSchema).min(1).max(14),
    lines: z.array(lineSchema).min(2).max(60),
  })
  .superRefine((s, ctx) => {
    const sceneIds = new Set(s.scenes.map((x) => x.id));
    let last = 0;
    for (const line of s.lines) {
      if (!sceneIds.has(line.scene)) {
        ctx.addIssue({ code: 'custom', message: `fala ${line.id}: cena ${line.scene} não existe` });
      }
      if (line.scene < last) {
        ctx.addIssue({ code: 'custom', message: `fala ${line.id}: cena volta para trás` });
      }
      last = line.scene;
    }
  });
export type VideoScript = z.infer<typeof videoScriptSchema>;
export type ScriptScene = VideoScript['scenes'][number];
export type ScriptLine = VideoScript['lines'][number];

export class ScriptValidationError extends Error {
  override name = 'ScriptValidationError';
  constructor(public readonly issues: string[]) {
    super(`roteiro inválido: ${issues.slice(0, 6).join('; ')}`);
  }
}

/** Texto falado de uma fala (sem marcações). Lança ScriptMarkupError se a marcação for inválida. */
export function spokenText(text: string): string {
  return parseScript(text).spokenText;
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter((w) => /\p{L}|\p{N}/u.test(w)).length;
}

/**
 * Normaliza e valida a saída do Roteirista: limpa espaços, corta excessos inofensivos
 * (título, textos de thumbnail), renumera e confere marcações. Lança ScriptValidationError.
 */
export function finalizeScript(raw: WriterOutput, format: VideoFormat): VideoScript {
  const issues: string[] = [];
  const trimTo = (s: string, n: number) => {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
  };
  const thumbs = raw.thumbnailTexts.map((t) => trimTo(t.toUpperCase(), 30)).filter(Boolean);
  while (thumbs.length < 3 && thumbs.length > 0) thumbs.push(thumbs[thumbs.length - 1]!);
  const candidate = {
    format,
    title: trimTo(raw.title, 100),
    description: trimTo(raw.description, 1500),
    thumbnailTexts: thumbs.slice(0, 3),
    thumbnailExpression: raw.thumbnailExpression,
    scenes: raw.scenes.map((s) => ({
      ...s,
      headline: s.headline ? trimTo(s.headline, 40) : null,
      imagePrompt: s.imagePrompt ? s.imagePrompt.trim() : null,
      libraryAssetId: s.libraryAssetId?.trim() || null,
    })),
    lines: raw.lines.map((l) => ({ ...l, text: l.text.trim() })),
  };
  const parsed = videoScriptSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ScriptValidationError(parsed.error.issues.map((i) => i.message));
  }
  for (const line of parsed.data.lines) {
    try {
      parseScript(line.text);
    } catch (err) {
      if (err instanceof ScriptMarkupError) issues.push(`fala ${line.id}: ${err.message}`);
      else throw err;
    }
  }
  if (issues.length) throw new ScriptValidationError(issues);
  return parsed.data;
}

/** Falas no formato da checagem de política (texto sem marcações). */
export function linesForCheck(script: VideoScript): ScriptLineForCheck[] {
  return script.lines.map((l) => ({
    id: l.id,
    kind: l.kind,
    spoken: spokenText(l.text),
    sourceIds: l.sourceIds,
  }));
}

/** Duração estimada da narração (para conferir com a duração-alvo antes de gastar voz). */
export function estimatedNarrationSec(script: VideoScript): number {
  const words = script.lines.reduce((n, l) => n + wordCount(spokenText(l.text)), 0);
  return words / WORDS_PER_SECOND;
}

/** Nome do job de produção na fila "render" (agents executa; o painel enfileira). */
export const PRODUCTION_JOB = 'production.run';

import { DEFAULT_PAUSE_MS, EXPRESSIONS, GESTURES, type Expression, type Gesture } from './spec';

/**
 * Marcações do roteiro do Zeca:
 *   [surpreso] texto...   muda a expressão a partir dali (até a próxima expressão)
 *   [aponta_tela] texto   começa um gesto naquele ponto
 *   [pausa] ou [pausa:800]  silêncio (ms) antes do próximo trecho
 * Cada marcação quebra o texto em trechos; cada trecho vira um áudio separado, então o
 * momento exato de cada expressão e gesto sai da duração real da voz.
 */

export interface ScriptSegment {
  text: string;
  expression: Expression;
  gestures: Gesture[];
  pauseAfterMs: number;
}

export interface ParsedScript {
  segments: ScriptSegment[];
  leadInMs: number;
  /** Texto falado, sem marcações (para conferência e contagem de caracteres). */
  spokenText: string;
  warnings: string[];
}

export class ScriptMarkupError extends Error {
  override name = 'ScriptMarkupError';
}

export const MAX_SCRIPT_CHARS = 6000;
const MAX_SEGMENTS = 200;
const TAG = /\[([^\]\n]{1,40})\]/g;

/** Nomes aceitos (sem acento, minúsculas), para mensagens de erro e para o painel. */
export const ALLOWED_TAGS = [...EXPRESSIONS, ...GESTURES, 'pausa', 'pausa:<ms>'];

function normalizeTag(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function parseScript(script: string, initial: Expression = 'neutro'): ParsedScript {
  if (script.length > MAX_SCRIPT_CHARS) {
    throw new ScriptMarkupError(`roteiro maior que ${MAX_SCRIPT_CHARS} caracteres`);
  }
  const segments: ScriptSegment[] = [];
  const warnings: string[] = [];
  let leadInMs = 0;
  let expression: Expression = initial;
  let pendingGestures: Gesture[] = [];
  let pendingPause = 0;

  const flushText = (raw: string) => {
    const text = cleanText(raw);
    if (!text) return;
    const last = segments.at(-1);
    if (last) last.pauseAfterMs += pendingPause;
    else leadInMs += pendingPause;
    pendingPause = 0;
    segments.push({ text, expression, gestures: pendingGestures, pauseAfterMs: 0 });
    pendingGestures = [];
  };

  let cursor = 0;
  for (const match of script.matchAll(TAG)) {
    flushText(script.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const tag = normalizeTag(match[1] ?? '');
    const pause = /^pausa(?::(\d{2,4}))?$/.exec(tag);
    if (pause) {
      const ms = pause[1] ? Number(pause[1]) : DEFAULT_PAUSE_MS;
      if (ms < 100 || ms > 3000) {
        throw new ScriptMarkupError(`[${match[1]}]: a pausa vai de 100 a 3000 ms`);
      }
      pendingPause += ms;
    } else if ((EXPRESSIONS as readonly string[]).includes(tag)) {
      expression = tag as Expression;
    } else if ((GESTURES as readonly string[]).includes(tag)) {
      if (!pendingGestures.includes(tag as Gesture)) pendingGestures.push(tag as Gesture);
    } else {
      throw new ScriptMarkupError(
        `marcação desconhecida [${match[1]}]. Use: ${ALLOWED_TAGS.map((t) => `[${t}]`).join(' ')}`,
      );
    }
  }
  flushText(script.slice(cursor));

  if (segments.length === 0) throw new ScriptMarkupError('o roteiro não tem nenhuma fala');
  if (segments.length > MAX_SEGMENTS) {
    throw new ScriptMarkupError(`roteiro com mais de ${MAX_SEGMENTS} trechos`);
  }
  if (pendingGestures.length) warnings.push('gesto no fim do roteiro, sem fala depois: ignorado');
  if (pendingPause) segments.at(-1)!.pauseAfterMs += pendingPause;

  return {
    segments,
    leadInMs,
    spokenText: segments.map((s) => s.text).join(' '),
    warnings,
  };
}

/** Expressões diferentes que o roteiro usa (o aceite pede pelo menos 3). */
export function expressionsUsed(parsed: ParsedScript): Expression[] {
  return [...new Set(parsed.segments.map((s) => s.expression))];
}

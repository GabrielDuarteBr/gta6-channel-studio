import type { CharacterBible } from '@studio/avatar';
import type { Llm } from '@studio/llm';
import { checkScript, type ScriptIssue, type SpoilerWindow } from '@studio/policy';
import {
  estimatedNarrationSec,
  finalizeScript,
  linesForCheck,
  ScriptValidationError,
  WORDS_PER_SECOND,
  writerOutputSchema,
  type VideoFormat,
  type VideoScript,
  type WriterOutput,
} from '@studio/production';

/**
 * Roteirista: história da Pauta → roteiro do Zeca (falas com fonte, cenas, textos de
 * thumbnail). A bíblia e as regras ficam no system (em cache); a história vai no user.
 * Depois do Claude, o código confere tudo (formato, marcações, fontes, rumor, regras 4/6/7)
 * e, se houver problema, pede UMA correção com a lista de problemas.
 */

export interface StorySource {
  id: string;
  source: string;
  tier: 'OFFICIAL' | 'PRESS' | 'COMMUNITY';
  domain: string;
  url: string;
  title: string;
  summary: string | null;
  publishedAt: string | null;
}

export interface LibraryOption {
  id: string;
  title: string;
  tags: string[];
  origin: string;
  credit: string | null;
}

export interface StoryForWriter {
  id: string;
  title: string;
  titlePt: string | null;
  summaryPt: string | null;
  kind: string | null;
  isRumor: boolean;
  sources: StorySource[];
  library: LibraryOption[];
}

export interface WriteScriptInput {
  story: StoryForWriter;
  format: VideoFormat;
  targetSec: number;
  maxGeneratedImages: number;
  bible: CharacterBible;
  model: string;
  spoilerWindow: SpoilerWindow;
  productionId: string;
  now?: Date;
}

export class ScriptRejectedError extends Error {
  override name = 'ScriptRejectedError';
  constructor(public readonly issues: string[]) {
    super(`o roteiro não passou nas regras: ${issues.slice(0, 5).join('; ')}`);
  }
}

export function writerSystemPrompt(bible: CharacterBible): string {
  return [
    `Você escreve os roteiros do ${bible.channel}, canal de notícias de GTA 6 em português do Brasil, apresentado pelo personagem animado ${bible.name}.`,
    '',
    '# Quem é o apresentador',
    bible.summary,
    'Personalidade:',
    ...bible.personality.map((p) => `- ${p}`),
    `Voz: ${bible.voice.tone}. Ritmo: ${bible.voice.pace}.`,
    `Bordões (use no máximo um por vídeo, sem forçar): ${bible.voice.catchphrases.join(' | ')}`,
    'Evitar:',
    ...bible.voice.avoid.map((a) => `- ${a}`),
    'Regras do personagem (inegociáveis):',
    ...bible.rules.map((r) => `- ${r}`),
    `Sobre IA: ${bible.aiDisclosure}`,
    '',
    '# Regras do canal (o código confere e devolve o roteiro se quebrar alguma)',
    '- Cada fala tem um tipo: abertura, fato, rumor, contexto, opiniao, chamada.',
    '- fato, rumor e contexto PRECISAM de sourceIds da lista de fontes da história. Nunca invente fonte, número, data ou preço que não esteja nas fontes.',
    '- Rumor: tipo "rumor", com pelo menos 2 fontes de sites diferentes, e a própria fala diz "rumor" ou "não confirmado".',
    '- Se a história é rumor, nada vira "fato" sem fonte oficial (Rockstar/Take-Two).',
    '- Nada de vazamento, cópia antecipada, datamine, trapaça online ou mods. Nada de spoiler de história, final ou reviravolta.',
    '- O apresentador nunca diz que é humano nem nega ser IA.',
    '- Comentário próprio: explique por que a notícia importa e dê opinião (tipo "opiniao"), sem só repetir a manchete.',
    '- Comece com um gancho nos primeiros segundos. Feche com uma chamada curta (sem pedir like de forma chata).',
    '',
    '# Marcações do apresentador (dentro do texto das falas)',
    'Expressões (valem até a próxima): [feliz] [surpreso] [serio] [debochado] [bravo] [neutro].',
    'Gestos: [aponta_tela] (quando mostra algo) e [aceno] (só na abertura). Pausa: [pausa] ou [pausa:600].',
    'Use expressões variadas (pelo menos 3 no vídeo longo) e poucas pausas. Não use outras marcações.',
    '',
    '# Cenas',
    '- Cada fala aponta para uma cena (scene), e as cenas só avançam (1, 1, 2, 3, 3...).',
    '- visual "biblioteca": use uma mídia da lista "Biblioteca" (libraryAssetId) quando combinar com a fala. Prefira imagens oficiais.',
    '- visual "gerar": imagem nova e original, descrita em inglês em imagePrompt (cenário, clima, objetos). PROIBIDO no prompt: GTA, Rockstar, nomes de personagens ou lugares do jogo (Vice City, Leonida, Lucia, Jason), logotipos, marcas, texto escrito, pessoas reais ou famosas.',
    '- visual "zeca": só o apresentador na tela (bom para abertura, opinião e chamada).',
    '- headline: título curto (até 40 caracteres) que aparece no começo da cena, ou null.',
    '',
    '# Thumbnail',
    '- thumbnailTexts: 3 opções diferentes, até 26 caracteres, que não prometam o que o vídeo não mostra. Rumor não vira certeza.',
    '- thumbnailExpression: a expressão do apresentador na thumbnail.',
  ].join('\n');
}

function userPrompt(input: WriteScriptInput, feedback: string[]): string {
  const { story, format, targetSec } = input;
  const words = Math.round(targetSec * WORDS_PER_SECOND);
  const lines = [
    `Formato: ${format === 'LONG' ? 'vídeo longo 16:9' : 'Short vertical 9:16 (máximo 58 s no total)'}.`,
    `Duração da narração: cerca de ${targetSec} s (≈ ${words} palavras faladas, sem contar marcações).`,
    `Imagens novas ("gerar"): no máximo ${input.maxGeneratedImages}. ${format === 'SHORT' ? 'Short: de 2 a 4 cenas.' : 'Vídeo longo: de 4 a 9 cenas.'}`,
    `Data de hoje: ${(input.now ?? new Date()).toISOString().slice(0, 10)}.`,
    '',
    '# História',
    `Título: ${story.titlePt ?? story.title}`,
    story.summaryPt ? `Resumo: ${story.summaryPt}` : '',
    `Tipo: ${story.kind ?? 'não classificado'}${story.isRumor ? ' (RUMOR)' : ''}`,
    '',
    '# Fontes (use os ids em sourceIds)',
    ...story.sources.map(
      (s) =>
        `- id=${s.id} | ${s.source} (${s.tier === 'OFFICIAL' ? 'OFICIAL' : s.tier === 'PRESS' ? 'imprensa' : 'comunidade'}, ${s.domain})${s.publishedAt ? ` | ${s.publishedAt.slice(0, 10)}` : ''}\n  ${s.title}${s.summary ? `\n  ${s.summary.slice(0, 400)}` : ''}`,
    ),
    '',
    '# Biblioteca (mídias com direitos, para visual "biblioteca")',
    ...(story.library.length
      ? story.library.map(
          (a) =>
            `- id=${a.id} | ${a.title} | ${a.origin}${a.tags.length ? ` | #${a.tags.join(' #')}` : ''}`,
        )
      : ['(vazia: use "gerar" ou "zeca")']),
  ];
  if (feedback.length) {
    lines.push(
      '',
      '# Corrija estes problemas da versão anterior',
      ...feedback.map((f) => `- ${f}`),
    );
  }
  return lines.filter((l) => l !== '').join('\n');
}

/** Roteiro do modo simulado: determinístico e dentro das regras (sem chamar a API). */
export function fakeWriterOutput(input: WriteScriptInput): WriterOutput {
  const { story, format } = input;
  const title = story.titlePt ?? story.title;
  const official = story.sources.filter((s) => s.tier === 'OFFICIAL');
  const lib = story.library[0];
  const allIds = story.sources.map((s) => s.id);
  const main = story.isRumor
    ? allIds.slice(0, 3)
    : official[0]
      ? [official[0].id]
      : allIds.slice(0, 1);
  const scenes: WriterOutput['scenes'] = [
    { id: 1, visual: 'zeca', libraryAssetId: null, imagePrompt: null, headline: null },
    lib
      ? {
          id: 2,
          visual: 'biblioteca',
          libraryAssetId: lib.id,
          imagePrompt: null,
          headline: 'A notícia',
        }
      : {
          id: 2,
          visual: 'gerar',
          libraryAssetId: null,
          imagePrompt:
            'Neon tropical city skyline at dusk, palm trees, wet streets reflecting magenta and cyan lights',
          headline: 'A notícia',
        },
    {
      id: 3,
      visual: input.maxGeneratedImages > 1 ? 'gerar' : 'zeca',
      libraryAssetId: null,
      imagePrompt:
        input.maxGeneratedImages > 1
          ? 'Retro sports car parked on an empty beach road at sunset, synthwave sky, palm trees'
          : null,
      headline: format === 'LONG' ? 'Por que importa' : null,
    },
  ];
  const lines: WriterOutput['lines'] = [
    {
      id: 1,
      scene: 1,
      kind: 'abertura',
      text: '[feliz] [aceno] Fala, galera do Radar!',
      sourceIds: [],
    },
    story.isRumor
      ? {
          id: 2,
          scene: 2,
          kind: 'rumor',
          text: `[surpreso] [aponta_tela] Olha esse rumor, ainda não confirmado: ${title}.`,
          sourceIds: main,
        }
      : {
          id: 2,
          scene: 2,
          kind: 'fato',
          text: `[surpreso] [aponta_tela] Saiu agora: ${title}.`,
          sourceIds: main,
        },
    {
      id: 3,
      scene: 3,
      kind: 'opiniao',
      text: story.isRumor
        ? '[serio] Calma: enquanto a Rockstar não falar, é só rumor, tá?'
        : '[serio] Isso mexe com a expectativa de todo mundo que tá esperando o jogo.',
      sourceIds: [],
    },
    {
      id: 4,
      scene: 3,
      kind: 'chamada',
      text: '[debochado] As fontes estão na descrição. Bora pro próximo sinal?',
      sourceIds: [],
    },
  ];
  return {
    title: `GTA 6: ${title}`.slice(0, 95),
    description: `O Zeca explica: ${title}.`,
    thumbnailTexts: story.isRumor
      ? ['RUMOR NO AR', 'SERÁ VERDADE?', 'NOVIDADE?']
      : ['SAIU AGORA', 'NOVIDADE DE GTA 6', 'OLHA ISSO'],
    thumbnailExpression: 'surpreso',
    scenes,
    lines,
  };
}

export interface WriteScriptResult {
  script: VideoScript;
  attempts: number;
  estimatedSec: number;
}

/** Erros que dá para mandar de volta ao Roteirista como correção. */
function reviewDraft(
  input: WriteScriptInput,
  raw: WriterOutput,
  checkLength: boolean,
): { script?: VideoScript; issues: string[] } {
  let script: VideoScript;
  try {
    script = finalizeScript(raw, input.format);
  } catch (err) {
    if (err instanceof ScriptValidationError) return { issues: err.issues };
    throw err;
  }
  const issues: ScriptIssue[] = checkScript({
    lines: linesForCheck(script),
    sources: input.story.sources.map((s) => ({
      id: s.id,
      domain: s.domain,
      official: s.tier === 'OFFICIAL',
    })),
    storyIsRumor: input.story.isRumor,
    spoilerWindow: input.spoilerWindow,
    ...(input.now ? { now: input.now } : {}),
  });
  const msgs = issues.map((i) => i.message);
  const libraryIds = new Set(input.story.library.map((a) => a.id));
  for (const s of script.scenes) {
    if (s.visual === 'biblioteca' && !libraryIds.has(s.libraryAssetId ?? '')) {
      msgs.push(`cena ${s.id}: mídia ${s.libraryAssetId} não está na Biblioteca`);
    }
  }
  const generated = script.scenes.filter((s) => s.visual === 'gerar').length;
  if (generated > input.maxGeneratedImages) {
    msgs.push(`${generated} imagens novas; o máximo é ${input.maxGeneratedImages}`);
  }
  // Duração só confere com o Claude de verdade (o roteiro simulado é curto de propósito).
  const est = estimatedNarrationSec(script);
  const maxSec = input.format === 'SHORT' ? 55 : input.targetSec * 1.4;
  if (est > maxSec) {
    msgs.push(`narração longa demais (~${Math.round(est)} s; alvo ${input.targetSec} s)`);
  }
  if (checkLength && est < input.targetSec * 0.45) {
    msgs.push(`narração curta demais (~${Math.round(est)} s; alvo ${input.targetSec} s)`);
  }
  return { script, issues: msgs };
}

export async function writeScript(llm: Llm, input: WriteScriptInput): Promise<WriteScriptResult> {
  const system = writerSystemPrompt(input.bible);
  let feedback: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const { data } = await llm.structured({
      task: 'agent:roteirista',
      model: input.model,
      system,
      user: userPrompt(input, feedback),
      schema: writerOutputSchema,
      effort: 'medium',
      maxTokens: 16000,
      fake: () => fakeWriterOutput(input),
      productionId: input.productionId,
    });
    const { script, issues } = reviewDraft(input, data, llm.isReal);
    if (script && issues.length === 0) {
      return { script, attempts: attempt, estimatedSec: estimatedNarrationSec(script) };
    }
    feedback = issues;
    if (!llm.isReal) break; // simulado: não adianta pedir de novo
  }
  throw new ScriptRejectedError(feedback);
}

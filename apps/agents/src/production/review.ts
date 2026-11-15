import type Anthropic from '@anthropic-ai/sdk';
import type { Llm } from '@studio/llm';
import type { VideoPlan } from '@studio/production';
import { z } from 'zod';

/**
 * Revisor visual: olha quadros-chave do vídeo e as 3 thumbnails (Claude com visão) e
 * devolve um veredito estruturado. O código decide a aprovação (nenhum problema grave ou
 * médio) e quais correções fechadas aplicar: trocar a imagem de uma cena ou descartar uma
 * thumbnail. Até 3 voltas (configurável); depois disso o vídeo fica para o dono decidir.
 */

export const ISSUE_KINDS = [
  'texto_ilegivel',
  'sobreposicao',
  'imagem_inadequada',
  'marca_ou_logo',
  'pessoa_real',
  'imagem_com_texto',
  'fonte_ausente',
  'rumor_sem_selo',
  'thumbnail_enganosa',
  'qualidade_baixa',
  'outro',
] as const;

export const reviewSchema = z.object({
  summary: z.string().describe('Resumo em 1 ou 2 frases, em português'),
  issues: z.array(
    z.object({
      target: z.enum(['quadro', 'thumbnail']),
      index: z.number().int().describe('número do quadro (1, 2...) ou da thumbnail (1, 2 ou 3)'),
      kind: z.enum(ISSUE_KINDS),
      severity: z.enum(['grave', 'media', 'leve']),
      detail: z.string().describe('o que está errado, em português, curto'),
      fix: z
        .enum(['trocar_imagem', 'descartar_thumbnail', 'nenhuma'])
        .describe(
          'trocar_imagem: a imagem de fundo da cena é o problema; descartar_thumbnail: a thumbnail não serve',
        ),
    }),
  ),
  bestThumbnail: z.number().int().describe('a melhor thumbnail: 1, 2 ou 3'),
});
export type ReviewOutput = z.infer<typeof reviewSchema>;

export interface ReviewFrame {
  t: number;
  jpegBase64: string;
}

export interface ReviewInput {
  plan: VideoPlan;
  frames: ReviewFrame[];
  thumbnails: Array<{ jpegBase64: string; headline: string }>;
  model: string;
  productionId: string;
  round: number;
}

export interface ReviewVerdict {
  approved: boolean;
  summary: string;
  issues: Array<ReviewOutput['issues'][number] & { scene: number | null; t: number | null }>;
  /** Cenas cuja imagem deve ser trocada. */
  replaceScenes: number[];
  /** Thumbnails (0..2) descartadas. */
  rejectedThumbnails: number[];
  /** Melhor thumbnail aproveitável (0..2), ou null se todas foram descartadas. */
  bestThumbnail: number | null;
  round: number;
}

export const REVIEWER_SYSTEM = [
  'Você é o revisor visual do Radar Neon, canal de notícias de GTA 6 apresentado pelo personagem animado Zeca Neon.',
  'Você recebe quadros-chave de um vídeo (com o que deveria aparecer em cada um) e 3 opções de thumbnail.',
  'Aponte só problemas reais e visíveis. Checklist:',
  '- Legenda, título da cena e selo de fonte legíveis (contraste, tamanho, sem cortar).',
  '- Texto em cima do rosto do personagem ou de outro texto (sobreposicao).',
  '- Imagem de fundo inadequada: violência explícita, conteúdo adulto, pessoa real identificável, logotipos ou marcas (inclusive Rockstar/GTA), texto deformado dentro da imagem gerada.',
  '- Quadro com afirmação sem o selo "FONTE" quando o roteiro diz que há fonte (fonte_ausente).',
  '- Trecho de rumor sem o selo "RUMOR" visível (rumor_sem_selo).',
  '- Thumbnail que promete o que o vídeo não mostra ou trata rumor como certeza (thumbnail_enganosa); texto ilegível na thumbnail.',
  '- O aviso de IA ("Apresentador animado com voz sintética") deve aparecer nos quadros do vídeo.',
  'NÃO reprove pelo estilo do personagem (a arte é provisória e marcada assim) nem por gosto pessoal.',
  'Gravidade: grave = não pode publicar; media = deve corrigir; leve = sugestão.',
  'Use fix "trocar_imagem" só quando o problema é a imagem de fundo daquela cena; "descartar_thumbnail" quando a thumbnail não serve.',
].join('\n');

const active = <T extends { start: number; end: number }>(items: T[], t: number) =>
  items.find((i) => t >= i.start && t < i.end);

export function sceneAt(plan: VideoPlan, t: number): number | null {
  return active(plan.scenes, t)?.id ?? null;
}

function frameContext(plan: VideoPlan, t: number, i: number): string {
  const scene = active(plan.scenes, t);
  const caption = active(plan.captions, t)?.text;
  const source = active(plan.sourceChips, t)?.label;
  const rumor = Boolean(active(plan.rumorSpans, t)) || plan.storyIsRumor;
  const outro = t >= plan.durationSec - plan.outroSec;
  return [
    `Quadro ${i + 1} (t=${t.toFixed(1)} s, cena ${scene?.id ?? '-'}${scene?.image ? ', com imagem de fundo' : ', só o personagem'})`,
    outro ? 'tela final (fontes na descrição)' : '',
    caption && !outro ? `legenda esperada: "${caption}"` : '',
    source && !outro ? `selo de fonte esperado: "${source}"` : '',
    rumor && !outro ? 'deve ter o selo RUMOR' : '',
  ]
    .filter(Boolean)
    .join(' | ');
}

export function reviewContent(input: ReviewInput): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [
    {
      type: 'text',
      text: `Vídeo "${input.plan.title}" (${input.plan.format === 'LONG' ? 'longo 16:9' : 'Short 9:16'}, ${input.plan.durationSec.toFixed(0)} s). Volta ${input.round} da revisão.`,
    },
  ];
  input.frames.forEach((f, i) => {
    blocks.push({ type: 'text', text: frameContext(input.plan, f.t, i) });
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: f.jpegBase64 },
    });
  });
  input.thumbnails.forEach((th, i) => {
    blocks.push({ type: 'text', text: `Thumbnail ${i + 1} (texto: "${th.headline}")` });
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: th.jpegBase64 },
    });
  });
  blocks.push({ type: 'text', text: 'Responda no formato pedido.' });
  return blocks;
}

/** Transforma a resposta do Claude no veredito (a aprovação é decidida aqui, não pelo modelo). */
export function verdictFrom(out: ReviewOutput, input: ReviewInput): ReviewVerdict {
  const issues = out.issues.map((i) => {
    const frame = i.target === 'quadro' ? input.frames[i.index - 1] : undefined;
    return {
      ...i,
      t: frame?.t ?? null,
      scene: frame ? sceneAt(input.plan, frame.t) : null,
    };
  });
  const blocking = issues.filter((i) => i.severity !== 'leve');
  const replaceScenes = [
    ...new Set(
      blocking
        .filter((i) => i.fix === 'trocar_imagem' && i.scene !== null)
        .map((i) => i.scene!)
        .filter((id) => input.plan.scenes.find((s) => s.id === id)?.image),
    ),
  ];
  const rejectedThumbnails = [
    ...new Set(
      blocking
        .filter(
          (i) => i.target === 'thumbnail' && i.index >= 1 && i.index <= input.thumbnails.length,
        )
        .map((i) => i.index - 1),
    ),
  ];
  const usable = input.thumbnails.map((_, i) => i).filter((i) => !rejectedThumbnails.includes(i));
  const preferred = out.bestThumbnail - 1;
  const bestThumbnail = usable.includes(preferred) ? preferred : (usable[0] ?? null);
  const videoBlocking = blocking.filter((i) => i.target === 'quadro');
  return {
    approved: videoBlocking.length === 0 && bestThumbnail !== null,
    summary: out.summary,
    issues,
    replaceScenes,
    rejectedThumbnails,
    bestThumbnail,
    round: input.round,
  };
}

export async function reviewVideo(llm: Llm, input: ReviewInput): Promise<ReviewVerdict> {
  const { data } = await llm.structured({
    task: 'agent:revisor-visual',
    model: input.model,
    system: REVIEWER_SYSTEM,
    user: reviewContent(input),
    schema: reviewSchema,
    effort: 'low',
    maxTokens: 8000,
    fake: () => ({
      summary: 'Revisão simulada: sem problemas apontados.',
      issues: [],
      bestThumbnail: 1,
    }),
    productionId: input.productionId,
  });
  return verdictFrom(data, input);
}

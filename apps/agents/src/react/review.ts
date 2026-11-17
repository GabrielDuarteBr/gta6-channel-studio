import type Anthropic from '@anthropic-ai/sdk';
import type { Llm } from '@studio/llm';
import type { ReactPlan } from '@studio/production';
import { z } from 'zod';

/**
 * Revisor visual do Short de react: quadros-chave (meio de cada clipe e de cada comentário) para
 * o Claude com visão. Confere o que a regra 3 exige na tela — crédito legível durante o clipe,
 * clipe pausado quando o Zeca fala — e a qualidade geral. A aprovação é decidida pelo código
 * (nenhum problema grave ou médio). Correção fechada: trocar o layout na próxima volta.
 */

export const REACT_ISSUE_KINDS = [
  'credito_ilegivel',
  'credito_ausente',
  'clipe_nao_pausado',
  'texto_ilegivel',
  'sobreposicao',
  'conteudo_inadequado',
  'marca_ou_logo',
  'qualidade_baixa',
  'outro',
] as const;

export const reactReviewSchema = z.object({
  summary: z.string().describe('Resumo em 1 ou 2 frases, em português'),
  issues: z.array(
    z.object({
      index: z.number().int().describe('número do quadro (1, 2...)'),
      kind: z.enum(REACT_ISSUE_KINDS),
      severity: z.enum(['grave', 'media', 'leve']),
      detail: z.string().describe('o que está errado, em português, curto'),
    }),
  ),
});
export type ReactReviewOutput = z.infer<typeof reactReviewSchema>;

export interface ReactVerdict {
  approved: boolean;
  summary: string;
  issues: Array<ReactReviewOutput['issues'][number] & { t: number | null }>;
  round: number;
  layout: string;
}

export const REACT_REVIEWER_SYSTEM = `Você é o revisor visual dos Shorts de react do canal "Radar Neon" (GTA 6, apresentador animado). Você recebe quadros-chave de um Short vertical e o que cada quadro deveria mostrar.

Confira em cada quadro:
- Quadro de CLIPE: o crédito "CLIPE: <nome do parceiro>" precisa estar legível na tela.
- Quadro de COMENTÁRIO: o clipe aparece pausado (escurecido, com o selo "PAUSADO") e o apresentador está em destaque; a legenda precisa estar legível.
- Em todos: nada cortado nas bordas, nada importante coberto por outro elemento, aviso de IA visível no topo, nada impróprio.

Severidade: grave = quebra a regra (crédito ausente/ilegível no clipe, clipe tocando enquanto o apresentador fala, conteúdo impróprio); media = atrapalha muito a leitura; leve = detalhe estético.
Não invente problema: se estiver tudo certo, devolva a lista vazia.`;

export interface ReactReviewInput {
  plan: ReactPlan;
  frames: Array<{ t: number; jpegBase64: string }>;
  model: string;
  productionId: string;
  round: number;
}

function frameContext(plan: ReactPlan, t: number, i: number): string {
  const block = plan.blocks.find((b) => t >= b.start && t < b.end);
  const outro = t >= plan.durationSec - 1.2;
  const what = outro
    ? 'tela final (crédito do parceiro e aviso de IA)'
    : block?.kind === 'clip'
      ? `CLIPE tocando: deve mostrar "CLIPE: ${plan.credit}" legível`
      : 'COMENTÁRIO: clipe pausado e escurecido, apresentador em destaque, legenda legível';
  return `Quadro ${i + 1} (t=${t.toFixed(1)} s) — ${what}`;
}

export function reactReviewContent(input: ReactReviewInput): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = [
    {
      type: 'text',
      text: `Short de react "${input.plan.title}" (${input.plan.durationSec.toFixed(0)} s, layout ${input.plan.layout}). Volta ${input.round} da revisão.`,
    },
  ];
  input.frames.forEach((f, i) => {
    blocks.push({ type: 'text', text: frameContext(input.plan, f.t, i) });
    blocks.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: f.jpegBase64 },
    });
  });
  blocks.push({ type: 'text', text: 'Responda no formato pedido.' });
  return blocks;
}

export function reactVerdictFrom(out: ReactReviewOutput, input: ReactReviewInput): ReactVerdict {
  const issues = out.issues.map((i) => ({ ...i, t: input.frames[i.index - 1]?.t ?? null }));
  return {
    approved: issues.every((i) => i.severity === 'leve'),
    summary: out.summary,
    issues,
    round: input.round,
    layout: input.plan.layout,
  };
}

export async function reviewReact(llm: Llm, input: ReactReviewInput): Promise<ReactVerdict> {
  const { data } = await llm.structured({
    task: 'agent:revisor-visual',
    model: input.model,
    system: REACT_REVIEWER_SYSTEM,
    user: reactReviewContent(input),
    schema: reactReviewSchema,
    effort: 'low',
    maxTokens: 6000,
    fake: () => ({ summary: 'Revisão simulada: sem problemas apontados.', issues: [] }),
    productionId: input.productionId,
  });
  return reactVerdictFrom(data, input);
}

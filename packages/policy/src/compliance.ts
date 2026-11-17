import { claimsToBeHuman } from './character';
import { detectContentFlags, isSpoilerWindowActive, type SpoilerWindow } from './content';
import { checkDescriptionConditions, type PartnerConditions } from './partner';
import { assertAssetRenderable, MIN_ORIGINAL_RATIO, type RenderableAsset } from './production';
import { PolicyViolation } from './rules';

/**
 * Conformidade (Fase 5): relatório BLOQUEANTE antes de qualquer envio ao YouTube. Junta as regras
 * inegociáveis num lugar só, com os dados reais do banco: direitos de cada mídia, permissão do
 * parceiro, originalidade, regra do react, aviso de IA, fontes, rumor, spoiler e os limites do
 * YouTube para título, descrição e tags. A revisão de texto com o Claude entra como aviso extra.
 */

export interface ComplianceCheck {
  id: string;
  ok: boolean;
  /** block = impede o envio; warn = o dono decide */
  severity: 'block' | 'warn';
  message: string;
}

export interface ComplianceReport {
  ok: boolean;
  checks: ComplianceCheck[];
  checkedAt: string;
}

export interface ComplianceInput {
  kind: 'NEWS' | 'REACT';
  format: 'LONG' | 'SHORT';
  title: string;
  description: string;
  tags: string[];
  assets: RenderableAsset[];
  /** Notícia: fração de narração própria (regra 5). */
  originalRatio?: number | null;
  /** Notícia: problemas que a checagem do roteiro ainda acusa (fontes, rumor, IA). */
  scriptIssues?: string[];
  storyIsRumor?: boolean;
  /** Notícia: há fontes listadas na descrição. */
  sourceCount?: number;
  react?: {
    clipRatio: number;
    commentRatio: number;
    conditions: PartnerConditions;
  } | null;
  spoilerWindow: SpoilerWindow;
  now?: Date;
}

/** Aviso de IA que tem de estar na descrição (regra 7). */
export const AI_NOTICE_PATTERN = /voz sint[eé]tica|intelig[eê]ncia artificial|\(IA\)|\bIA\b/i;

const TITLE_MAX = 100;
const DESCRIPTION_MAX = 5000;
const TAGS_MAX_CHARS = 500;

export function checkCompliance(input: ComplianceInput): ComplianceReport {
  const now = input.now ?? new Date();
  const checks: ComplianceCheck[] = [];
  const add = (id: string, ok: boolean, message: string, severity: 'block' | 'warn' = 'block') =>
    checks.push({ id, ok, severity, message });

  // Regra 1/2: toda mídia com manifesto ativo; parceiro com permissão ativa.
  const rightsProblems: string[] = [];
  for (const a of input.assets) {
    try {
      assertAssetRenderable(a, now);
    } catch (err) {
      if (err instanceof PolicyViolation)
        rightsProblems.push(err.message.replace(/^\[[A-Z_]+\]\s*/, ''));
      else throw err;
    }
  }
  add(
    'direitos',
    rightsProblems.length === 0,
    rightsProblems.length
      ? `Direitos: ${rightsProblems.slice(0, 3).join(' ')}`
      : `Direitos em dia (${input.assets.length} mídia(s) com manifesto ativo).`,
  );

  if (input.kind === 'NEWS') {
    const ratio = input.originalRatio ?? 0;
    add(
      'originalidade',
      ratio >= MIN_ORIGINAL_RATIO,
      `Comentário próprio: ${Math.round(ratio * 100)}% (mínimo ${MIN_ORIGINAL_RATIO * 100}%).`,
    );
    const issues = input.scriptIssues ?? [];
    add(
      'fatos',
      issues.length === 0,
      issues.length
        ? `Roteiro: ${issues.slice(0, 3).join('; ')}`
        : 'Toda afirmação do roteiro tem fonte.',
    );
    add(
      'fontes-descricao',
      (input.sourceCount ?? 0) > 0,
      (input.sourceCount ?? 0) > 0
        ? `Descrição com ${input.sourceCount} fonte(s).`
        : 'A descrição precisa listar as fontes.',
    );
    if (input.storyIsRumor) {
      const labeled = /rumor|n[aã]o confirmad|suposto|teria/i.test(
        `${input.title} ${input.description}`,
      );
      add(
        'rumor',
        labeled,
        labeled
          ? 'Rumor rotulado no título/descrição.'
          : 'É rumor: diga "rumor" ou "não confirmado" no título ou na descrição.',
      );
    }
  }

  if (input.kind === 'REACT') {
    const r = input.react;
    if (!r) {
      add('react', false, 'Short de react sem os dados do plano.');
    } else {
      add(
        'react-proporcao',
        r.clipRatio <= 0.5 && r.commentRatio >= 0.5,
        `Clipe ${Math.round(r.clipRatio * 100)}% · comentário ${Math.round(r.commentRatio * 100)}% (clipe ≤ 50%, comentário ≥ 50%).`,
      );
      const missing = checkDescriptionConditions(input.description, r.conditions);
      add(
        'condicoes-parceiro',
        missing.length === 0,
        missing.length
          ? `Faltam na descrição: ${missing.join(', ')}.`
          : 'Crédito, link e hashtag do parceiro na descrição.',
      );
      if (r.conditions.monetization === 'not_allowed') {
        add(
          'monetizacao',
          false,
          'O parceiro NÃO permite monetizar: desligue os anúncios deste vídeo no YouTube Studio.',
          'warn',
        );
      }
    }
  }

  // Regra 7: aviso de IA na descrição (a marca de conteúdo sintético vai sempre no envio).
  const aiOk = AI_NOTICE_PATTERN.test(input.description);
  add(
    'ia',
    aiOk,
    aiOk
      ? 'Aviso de IA na descrição; envio marcado como conteúdo sintético.'
      : 'Falta o aviso de IA na descrição.',
  );

  // Título e descrição: nada de humano, vazamento, trapaça, mods ou spoiler na janela.
  const text = `${input.title}\n${input.description}`;
  add(
    'humano',
    !claimsToBeHuman(text),
    claimsToBeHuman(text)
      ? 'O texto diz que o apresentador é humano.'
      : 'O apresentador não se diz humano.',
  );
  const flags = detectContentFlags(text);
  const rockstar = flags.leak || flags.onlineCheats || flags.mods;
  add(
    'rockstar',
    !rockstar,
    rockstar
      ? 'Título/descrição falam de vazamento, trapaça ou mods.'
      : 'Sem vazamento, trapaça ou mods.',
  );
  if (flags.spoilerRisk && isSpoilerWindowActive(input.spoilerWindow, now)) {
    add('spoiler', false, 'Possível spoiler no título/descrição dentro da janela anti-spoiler.');
  }

  // Limites do YouTube.
  const angle = /[<>]/.test(text);
  add(
    'limites-youtube',
    input.title.trim().length > 0 &&
      input.title.length <= TITLE_MAX &&
      input.description.length <= DESCRIPTION_MAX &&
      input.tags.join(',').length <= TAGS_MAX_CHARS &&
      !angle,
    `Título ${input.title.length}/${TITLE_MAX}, descrição ${input.description.length}/${DESCRIPTION_MAX}, tags ${input.tags.join(',').length}/${TAGS_MAX_CHARS}${angle ? ' — tire os sinais < e >' : ''}.`,
  );

  return {
    ok: checks.every((c) => c.ok || c.severity === 'warn'),
    checks,
    checkedAt: now.toISOString(),
  };
}

/** Une um aviso vindo da revisão de texto (Claude) ao relatório. */
export function withTextReview(
  report: ComplianceReport,
  review: { misleading: boolean; notes: string[] },
): ComplianceReport {
  const checks: ComplianceCheck[] = [
    ...report.checks,
    {
      id: 'texto-enganoso',
      ok: !review.misleading,
      severity: review.misleading ? 'block' : 'warn',
      message: review.misleading
        ? `Revisão de texto: título/descrição prometem o que o vídeo não mostra. ${review.notes.slice(0, 2).join(' ')}`
        : review.notes.length
          ? `Revisão de texto: ${review.notes.slice(0, 2).join(' ')}`
          : 'Revisão de texto: título e descrição batem com o vídeo.',
    },
  ];
  return { ...report, checks, ok: checks.every((c) => c.ok || c.severity === 'warn') };
}

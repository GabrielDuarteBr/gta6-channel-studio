/**
 * Vocabulário do personagem: expressões, gestos e formas de boca.
 * As marcações do roteiro ([surpreso], [aponta_tela]...) só aceitam estes nomes.
 */

export const EXPRESSIONS = [
  'neutro',
  'feliz',
  'empolgado',
  'debochado',
  'desconfiado',
  'surpreso',
  'serio',
  'bravo',
] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export const GESTURES = ['aponta_tela', 'aceno'] as const;
export type Gesture = (typeof GESTURES)[number];

/** Formas de boca do Rhubarb (padrão Preston Blair). X = boca em repouso. */
export const MOUTH_SHAPES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X'] as const;
export type MouthShape = (typeof MOUTH_SHAPES)[number];

export const EXPRESSION_LABEL: Record<Expression, string> = {
  neutro: 'Neutro',
  feliz: 'Feliz',
  empolgado: 'Empolgado',
  debochado: 'Debochado',
  desconfiado: 'Desconfiado',
  surpreso: 'Surpreso',
  serio: 'Sério',
  bravo: 'Bravo',
};

/** Quando usar cada expressão (vai no prompt do roteirista e do comentarista). */
export const EXPRESSION_USE: Record<Expression, string> = {
  neutro: 'transição ou explicação rápida',
  feliz: 'notícia boa, fechamento, elogio ao parceiro',
  empolgado: 'novidade grande (com fonte), abertura com energia',
  debochado: 'zoeira com a situação (atraso, preço, internet)',
  desconfiado: 'rumor, promessa duvidosa, "será mesmo?"',
  surpreso: 'revelação, número ou detalhe inesperado',
  serio: 'alerta importante ("não cai nessa", golpe, vazamento)',
  bravo: 'raro: atraso, golpe contra a comunidade',
};

export const GESTURE_LABEL: Record<Gesture, string> = {
  aponta_tela: 'Aponta para a tela',
  aceno: 'Aceno',
};

/** O que cada forma de boca representa (para a galeria do painel). */
export const MOUTH_LABEL: Record<MouthShape, string> = {
  A: 'M, B, P (lábios fechados)',
  B: 'K, S, T, I (dentes quase juntos)',
  C: 'É, Ê (aberta)',
  D: 'A (bem aberta)',
  E: 'Ó, R (arredondada)',
  F: 'U, O, W (bico)',
  G: 'F, V (dente no lábio)',
  H: 'L (língua para cima)',
  X: 'repouso',
};

/** Duração padrão dos gestos (segundos) e da pausa [pausa]. */
export const GESTURE_SECONDS: Record<Gesture, number> = { aponta_tela: 1.8, aceno: 1.4 };
export const DEFAULT_PAUSE_MS = 400;

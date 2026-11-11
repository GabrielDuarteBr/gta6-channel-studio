/**
 * Preços por milhão de tokens (US$), tabela da API da Anthropic em 03/11/2026.
 * Confira os valores atuais antes de mudar; o orçamento do painel depende deles.
 * Escrita no cache (TTL 5 min) ≈ 1,25 × entrada; leitura do cache conforme a tabela
 * (ou 0,1 × entrada quando a tabela não traz o valor).
 */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number;
  /** Haiku 5.5: preço maior para prompts acima de 100K tokens. */
  longContext?: { thresholdTokens: number; input: number; output: number };
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    longContext: { thresholdTokens: 100_000, input: 0.5, output: 2.5 },
  },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
};

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function costUsd(model: string, usage: TokenUsage): number {
  const p = MODEL_PRICES[model];
  if (!p) throw new Error(`Modelo sem preço cadastrado: ${model}`);
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const promptTokens = usage.input_tokens + cacheRead + cacheWrite;
  const long =
    p.longContext && promptTokens > p.longContext.thresholdTokens ? p.longContext : undefined;
  const inPrice = long?.input ?? p.input;
  const outPrice = long?.output ?? p.output;
  const usd =
    (usage.input_tokens * inPrice +
      cacheWrite * inPrice * 1.25 +
      cacheRead * p.cacheRead +
      usage.output_tokens * outPrice) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';
import { costUsd, type TokenUsage } from './pricing';

/** Registro de custo de cada chamada (vai para o CostLedger). */
export interface LlmCostRecord {
  task: string;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  simulated: boolean;
}

export interface StructuredRequest<S extends z.ZodType> {
  /** ex.: "agent:pesquisador.triagem" */
  task: string;
  model: string;
  /** Instruções estáveis (ficam em cache). */
  system: string;
  /** Conteúdo variável da chamada. */
  user: string;
  schema: S;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  /** Resposta do modo simulado (sem chamar a API). */
  fake: () => z.infer<S>;
}

export interface StructuredResult<T> {
  data: T;
  cost: LlmCostRecord;
}

export class BudgetExceededError extends Error {
  override name = 'BudgetExceededError';
}
export class LlmRefusalError extends Error {
  override name = 'LlmRefusalError';
}
export class LlmOutputError extends Error {
  override name = 'LlmOutputError';
}

export interface BudgetStatus {
  spentTodayUsd: number;
  spentMonthUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
}

export interface LlmDeps {
  /** Modo simulado: nunca chama a API. */
  simulation: boolean;
  apiKey?: string | undefined;
  /** Lê gastos e tetos (CostLedger + configurações). */
  budget: () => Promise<BudgetStatus>;
  /** Grava o custo (também no modo simulado, com custo 0). */
  record: (cost: LlmCostRecord) => Promise<void>;
  /** Para testes: cliente da Anthropic injetado. */
  client?: Pick<Anthropic, 'messages'>;
}

/** Ainda há orçamento? Pausa os agentes quando o teto diário ou mensal é atingido. */
export function assertWithinBudget(b: BudgetStatus): void {
  if (b.spentMonthUsd >= b.monthlyLimitUsd) {
    throw new BudgetExceededError(
      `Teto mensal de US$ ${b.monthlyLimitUsd.toFixed(2)} atingido (gasto: ${b.spentMonthUsd.toFixed(2)}).`,
    );
  }
  if (b.spentTodayUsd >= b.dailyLimitUsd) {
    throw new BudgetExceededError(
      `Teto diário de US$ ${b.dailyLimitUsd.toFixed(2)} atingido (gasto: ${b.spentTodayUsd.toFixed(2)}).`,
    );
  }
}

export class Llm {
  private readonly client: Pick<Anthropic, 'messages'> | undefined;

  constructor(private readonly deps: LlmDeps) {
    this.client =
      deps.client ??
      (deps.apiKey ? new Anthropic({ apiKey: deps.apiKey, maxRetries: 4 }) : undefined);
  }

  /** Pode chamar a API de verdade agora? (chave presente e fora do modo simulado) */
  get isReal(): boolean {
    return !this.deps.simulation && this.client !== undefined;
  }

  async structured<S extends z.ZodType>(
    req: StructuredRequest<S>,
  ): Promise<StructuredResult<z.infer<S>>> {
    if (!this.isReal) {
      const cost: LlmCostRecord = {
        task: req.task,
        model: req.model,
        usage: { input_tokens: 0, output_tokens: 0 },
        costUsd: 0,
        simulated: true,
      };
      await this.deps.record(cost);
      return { data: req.schema.parse(req.fake()), cost };
    }

    assertWithinBudget(await this.deps.budget());
    const client = this.client as Pick<Anthropic, 'messages'>;
    const response = await client.messages.parse({
      model: req.model,
      max_tokens: req.maxTokens ?? 8000,
      // Instruções estáveis primeiro, em cache; conteúdo variável depois.
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }],
      output_config: { effort: req.effort ?? 'low', format: zodOutputFormat(req.schema) },
    });

    const usage: TokenUsage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
    };
    const cost: LlmCostRecord = {
      task: req.task,
      model: req.model,
      usage,
      costUsd: costUsd(req.model, usage),
      simulated: false,
    };
    await this.deps.record(cost);

    if (response.stop_reason === 'refusal') {
      throw new LlmRefusalError(
        `O modelo recusou a tarefa ${req.task} (${response.stop_details?.category ?? 'sem categoria'}).`,
      );
    }
    if (response.stop_reason === 'max_tokens') {
      throw new LlmOutputError(`Resposta cortada por max_tokens na tarefa ${req.task}.`);
    }
    if (response.parsed_output == null) {
      throw new LlmOutputError(`Saída fora do formato esperado na tarefa ${req.task}.`);
    }
    return { data: response.parsed_output as z.infer<S>, cost };
  }
}

import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { toJSONSchema, type z } from 'zod';
import { costUsd, MODEL_PRICES, type TokenUsage } from './pricing';

/** Registro de custo de cada chamada (vai para o CostLedger). */
export interface LlmCostRecord {
  task: string;
  model: string;
  usage: TokenUsage;
  costUsd: number;
  simulated: boolean;
  /** Vídeo a que o gasto pertence (custo real por vídeo). */
  productionId?: string | undefined;
}

/**
 * Modelos com fallback do servidor quando o modelo recusa um pedido (o servidor escolhe o
 * modelo de reserva pela categoria da recusa). Ver claude-api: "Refusal Fallbacks".
 */
export const SERVER_FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5']);

export interface StructuredRequest<S extends z.ZodType> {
  /** ex.: "agent:pesquisador.triagem" */
  task: string;
  model: string;
  /** Instruções estáveis (ficam em cache). */
  system: string;
  /** Conteúdo variável da chamada (texto, ou blocos com imagens para o Revisor visual). */
  user: string | Anthropic.ContentBlockParam[];
  schema: S;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  /** Resposta do modo simulado (sem chamar a API). */
  fake: () => z.infer<S>;
  productionId?: string | undefined;
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

/**
 * Gastos e tetos em dólar (a moeda das APIs). O teto é configurado em reais e convertido pela
 * cotação efetiva (`brlPerUsd`), que também deixa as mensagens em R$.
 */
export interface BudgetStatus {
  spentTodayUsd: number;
  spentMonthUsd: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  /** Reais por dólar com spread e IOF; sem ele, as mensagens saem em US$. */
  brlPerUsd?: number;
}

function money(usd: number, brlPerUsd?: number): string {
  if (!brlPerUsd) return `US$ ${usd.toFixed(2)}`;
  return `R$ ${(usd * brlPerUsd).toFixed(2).replace('.', ',')}`;
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
  client?: Pick<Anthropic, 'messages' | 'beta'>;
}

/** Ainda há orçamento? Pausa os agentes quando o teto diário ou mensal é atingido. */
export function assertWithinBudget(b: BudgetStatus): void {
  if (b.spentMonthUsd >= b.monthlyLimitUsd) {
    throw new BudgetExceededError(
      `Teto mensal de ${money(b.monthlyLimitUsd, b.brlPerUsd)} atingido (gasto: ${money(b.spentMonthUsd, b.brlPerUsd)}).`,
    );
  }
  if (b.spentTodayUsd >= b.dailyLimitUsd) {
    throw new BudgetExceededError(
      `Teto diário de ${money(b.dailyLimitUsd, b.brlPerUsd)} atingido (gasto: ${money(b.spentTodayUsd, b.brlPerUsd)}).`,
    );
  }
}

export class Llm {
  private readonly client: Pick<Anthropic, 'messages' | 'beta'> | undefined;

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
        productionId: req.productionId,
      };
      await this.deps.record(cost);
      return { data: req.schema.parse(req.fake()), cost };
    }

    assertWithinBudget(await this.deps.budget());
    const client = this.client as Pick<Anthropic, 'messages' | 'beta'>;
    // Instruções estáveis primeiro, em cache; conteúdo variável depois.
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
    ];
    const response = SERVER_FALLBACK_MODELS.has(req.model)
      ? await client.beta.messages.parse({
          model: req.model,
          max_tokens: req.maxTokens ?? 16000,
          system,
          messages: [
            { role: 'user', content: req.user as Anthropic.Beta.BetaContentBlockParam[] | string },
          ],
          output_config: { effort: req.effort ?? 'low', format: betaZodOutputFormat(req.schema) },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
        })
      : await client.messages.parse({
          model: req.model,
          max_tokens: req.maxTokens ?? 8000,
          system,
          messages: [{ role: 'user', content: req.user }],
          output_config: { effort: req.effort ?? 'low', format: zodOutputFormat(req.schema) },
        });

    const usage: TokenUsage = {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens,
    };
    // Se o fallback do servidor respondeu, o preço é o do modelo que respondeu.
    const servedBy = response.model in MODEL_PRICES ? response.model : req.model;
    const cost: LlmCostRecord = {
      task: req.task,
      model: servedBy,
      usage,
      costUsd: costUsd(servedBy, usage),
      simulated: false,
      productionId: req.productionId,
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

  /**
   * Chat com ferramentas (Comando): laço manual em streaming. O texto sai aos pedaços em
   * `onText`; cada ferramenta pedida é validada com zod antes de rodar (entrada inválida volta
   * como erro para o modelo). Sem modo simulado/sem chave, usa `fake`.
   */
  async toolChat(req: ToolChatRequest): Promise<ToolChatResult> {
    const calls: ChatToolCall[] = [];
    if (!this.isReal) {
      const plan = await req.fake();
      for (const c of plan.calls) {
        const call = await runChatTool(req.tools, c.name, c.input);
        calls.push(call);
        await req.onTool?.(call);
      }
      const text = plan.reply(calls);
      for (const part of text.match(/.{1,24}(\s|$)/gs) ?? [text]) await req.onText?.(part);
      await this.deps.record({
        task: req.task,
        model: req.model,
        usage: { input_tokens: 0, output_tokens: 0 },
        costUsd: 0,
        simulated: true,
      });
      return { text, calls, costUsd: 0 };
    }

    const client = this.client as Pick<Anthropic, 'messages' | 'beta'>;
    const tools: Anthropic.Beta.BetaTool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: jsonSchemaOf(t.schema),
      eager_input_streaming: true,
    }));
    // Cache: ferramentas + instruções estáveis primeiro.
    const last = tools.at(-1);
    if (last) last.cache_control = { type: 'ephemeral' };
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
    ];
    const messages: Anthropic.Beta.BetaMessageParam[] = [
      ...req.history.map((m) => ({ role: m.role, content: m.text })),
      { role: 'user', content: req.user },
    ];
    let text = '';
    let total = 0;
    let jsonRetries = 0;
    const fallback = SERVER_FALLBACK_MODELS.has(req.model);
    for (let round = 0; round < (req.maxRounds ?? 6); round++) {
      assertWithinBudget(await this.deps.budget());
      const stream = client.beta.messages.stream({
        model: req.model,
        max_tokens: 16000,
        system,
        tools,
        messages,
        output_config: { effort: 'low' },
        ...(fallback
          ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
          : {}),
      });
      stream.on('text', (delta) => {
        text += delta;
        void req.onText?.(delta);
      });
      let message: Anthropic.Beta.BetaMessage;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        if (err instanceof Anthropic.APIError || jsonRetries++ >= 2) throw err;
        continue;
      }
      const usage: TokenUsage = {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        cache_read_input_tokens: message.usage.cache_read_input_tokens,
        cache_creation_input_tokens: message.usage.cache_creation_input_tokens,
      };
      const servedBy = message.model in MODEL_PRICES ? message.model : req.model;
      const cost = costUsd(servedBy, usage);
      total += cost;
      await this.deps.record({
        task: req.task,
        model: servedBy,
        usage,
        costUsd: cost,
        simulated: false,
      });

      if (message.stop_reason === 'refusal') {
        throw new LlmRefusalError(
          `O modelo recusou o pedido (${message.stop_details?.category ?? 'sem categoria'}).`,
        );
      }
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      const uses = message.content.filter(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use',
      );
      if (uses.length === 0) return { text, calls, costUsd: total };
      if (message.stop_reason === 'max_tokens') {
        throw new LlmOutputError('Pedido de ferramenta cortado por max_tokens.');
      }
      messages.push({ role: 'assistant', content: message.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const use of uses) {
        const call = await runChatTool(req.tools, use.name, use.input);
        calls.push(call);
        await req.onTool?.(call);
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          is_error: !call.ok,
          content: JSON.stringify(call.result).slice(0, 12000),
        });
      }
      messages.push({ role: 'user', content: results });
      if (text && !text.endsWith('\n')) {
        text += '\n\n';
        void req.onText?.('\n\n');
      }
    }
    throw new LlmOutputError('O chat passou do limite de rodadas de ferramentas.');
  }
}

/** Ferramenta fechada do chat: o modelo só escolhe entre estas operações tipadas. */
export interface ChatTool {
  name: string;
  description: string;
  schema: z.ZodType;
  run: (input: never) => Promise<unknown>;
}

/** Define uma ferramenta com a entrada tipada pelo schema zod. */
export function chatTool<S extends z.ZodType>(tool: {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>) => Promise<unknown>;
}): ChatTool {
  return tool as ChatTool;
}

export interface ChatToolCall {
  name: string;
  input: unknown;
  ok: boolean;
  result: unknown;
}

export interface ToolChatRequest {
  task: string;
  model: string;
  system: string;
  /** Conversa anterior só em texto (blocos de pensamento de turnos antigos não voltam). */
  history: Array<{ role: 'user' | 'assistant'; text: string }>;
  user: string;
  tools: ChatTool[];
  onText?: (delta: string) => void | Promise<void>;
  onTool?: (call: ChatToolCall) => void | Promise<void>;
  maxRounds?: number;
  /** Modo simulado: decide as ferramentas e a resposta sem chamar a API. */
  fake: () => Promise<{
    calls: Array<{ name: string; input: unknown }>;
    reply: (results: ChatToolCall[]) => string;
  }>;
}

export interface ToolChatResult {
  text: string;
  calls: ChatToolCall[];
  costUsd: number;
}

function jsonSchemaOf(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const { $schema: _ignored, ...rest } = toJSONSchema(schema) as Record<string, unknown>;
  return rest as Anthropic.Beta.BetaTool.InputSchema;
}

async function runChatTool(tools: ChatTool[], name: string, input: unknown): Promise<ChatToolCall> {
  const tool = tools.find((t) => t.name === name);
  if (!tool)
    return { name, input, ok: false, result: { erro: `ferramenta desconhecida: ${name}` } };
  const parsed = tool.schema.safeParse(input);
  if (!parsed.success) {
    return {
      name,
      input,
      ok: false,
      result: { erro: 'entrada inválida', detalhes: parsed.error.issues.slice(0, 5) },
    };
  }
  try {
    return { name, input: parsed.data, ok: true, result: await tool.run(parsed.data as never) };
  } catch (err) {
    return {
      name,
      input: parsed.data,
      ok: false,
      result: { erro: (err as Error).message.slice(0, 400) },
    };
  }
}

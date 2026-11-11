import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  assertWithinBudget,
  BudgetExceededError,
  costUsd,
  Llm,
  LlmRefusalError,
  type BudgetStatus,
  type LlmCostRecord,
} from '../src';

const schema = z.object({ answer: z.string() });
const okBudget: BudgetStatus = {
  spentTodayUsd: 0.1,
  spentMonthUsd: 2,
  dailyLimitUsd: 1.6,
  monthlyLimitUsd: 50,
};

function fakeClient(response: Record<string, unknown>) {
  const parse = vi.fn().mockResolvedValue(response);
  return { client: { messages: { parse } } as never, parse };
}

const baseReq = {
  task: 'teste',
  model: 'claude-haiku-5-5',
  system: 'sistema estável',
  user: 'pergunta',
  schema,
  fake: () => ({ answer: 'simulado' }),
};

describe('preços', () => {
  it('calcula o custo do Haiku 5.5 com cache', () => {
    // 10k entrada + 2k saída = 0,001 + 0,001
    expect(costUsd('claude-haiku-5-5', { input_tokens: 10_000, output_tokens: 2_000 })).toBeCloseTo(
      0.002,
      6,
    );
    // leitura de cache sai a 0,01/MTok
    expect(
      costUsd('claude-haiku-5-5', {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_input_tokens: 1_000_000,
      }),
    ).toBeCloseTo(0.01, 6);
    expect(() => costUsd('modelo-inexistente', { input_tokens: 1, output_tokens: 1 })).toThrow();
  });
});

describe('orçamento', () => {
  it('pausa no teto diário ou mensal', () => {
    expect(() => assertWithinBudget(okBudget)).not.toThrow();
    expect(() => assertWithinBudget({ ...okBudget, spentTodayUsd: 1.6 })).toThrow(
      BudgetExceededError,
    );
    expect(() => assertWithinBudget({ ...okBudget, spentMonthUsd: 50 })).toThrow(/mensal/);
  });
});

describe('Llm.structured', () => {
  it('modo simulado: não chama a API, usa o fake e registra custo 0', async () => {
    const { client, parse } = fakeClient({});
    const records: LlmCostRecord[] = [];
    const llm = new Llm({
      simulation: true,
      client,
      budget: async () => okBudget,
      record: async (c) => void records.push(c),
    });
    const res = await llm.structured(baseReq);
    expect(res.data).toEqual({ answer: 'simulado' });
    expect(parse).not.toHaveBeenCalled();
    expect(records[0]).toMatchObject({ simulated: true, costUsd: 0 });
  });

  it('modo real: system em cache, esforço baixo, saída estruturada e custo registrado', async () => {
    const { client, parse } = fakeClient({
      stop_reason: 'end_turn',
      parsed_output: { answer: '42' },
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 3000,
        cache_creation_input_tokens: 0,
      },
    });
    const records: LlmCostRecord[] = [];
    const llm = new Llm({
      simulation: false,
      client,
      budget: async () => okBudget,
      record: async (c) => void records.push(c),
    });
    const res = await llm.structured(baseReq);
    expect(res.data).toEqual({ answer: '42' });
    const args = parse.mock.calls[0]?.[0];
    expect(args.model).toBe('claude-haiku-5-5');
    expect(args.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(args.output_config.effort).toBe('low');
    expect(args.output_config.format).toBeTruthy();
    expect(records[0]?.costUsd).toBeGreaterThan(0);
    expect(records[0]?.simulated).toBe(false);
  });

  it('não chama a API sem orçamento', async () => {
    const { client, parse } = fakeClient({});
    const llm = new Llm({
      simulation: false,
      client,
      budget: async () => ({ ...okBudget, spentTodayUsd: 9 }),
      record: async () => {},
    });
    await expect(llm.structured(baseReq)).rejects.toBeInstanceOf(BudgetExceededError);
    expect(parse).not.toHaveBeenCalled();
  });

  it('recusa vira LlmRefusalError (e o custo fica registrado)', async () => {
    const { client } = fakeClient({
      stop_reason: 'refusal',
      stop_details: { category: 'cyber' },
      parsed_output: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    });
    const records: LlmCostRecord[] = [];
    const llm = new Llm({
      simulation: false,
      client,
      budget: async () => okBudget,
      record: async (c) => void records.push(c),
    });
    await expect(llm.structured(baseReq)).rejects.toBeInstanceOf(LlmRefusalError);
    expect(records).toHaveLength(1);
  });

  it('sem chave de API, fica no simulado mesmo com o modo real ligado', () => {
    const llm = new Llm({
      simulation: false,
      budget: async () => okBudget,
      record: async () => {},
    });
    expect(llm.isReal).toBe(false);
  });
});

import { DEFAULT_BIBLE } from '@studio/avatar';
import { Llm, type LlmCostRecord } from '@studio/llm';
import { describe, expect, it, vi } from 'vitest';
import {
  fakeWriterOutput,
  ScriptRejectedError,
  writeScript,
  writerSystemPrompt,
  type WriteScriptInput,
} from '../src/production/writer';

const input: WriteScriptInput = {
  story: {
    id: 's1',
    title: 'Rockstar confirms new trailer date',
    titlePt: 'Rockstar confirma data do novo trailer',
    summaryPt: 'A Rockstar anunciou no Newswire a data do próximo trailer.',
    kind: 'oficial',
    isRumor: false,
    sources: [
      {
        id: 'n1',
        source: 'Rockstar Newswire',
        tier: 'OFFICIAL',
        domain: 'rockstargames.com',
        url: 'https://www.rockstargames.com/newswire/article/1',
        title: 'New trailer date',
        summary: null,
        publishedAt: '2026-11-15T10:00:00Z',
      },
      {
        id: 'n2',
        source: 'IGN',
        tier: 'PRESS',
        domain: 'ign.com',
        url: 'https://www.ign.com/x',
        title: 'Rockstar sets date',
        summary: null,
        publishedAt: null,
      },
    ],
    library: [],
  },
  format: 'LONG',
  targetSec: 60,
  maxGeneratedImages: 3,
  bible: DEFAULT_BIBLE,
  model: 'claude-sonnet-5-5',
  spoilerWindow: { launchDate: '2026-11-19', windowDays: 30 },
  productionId: 'p1',
  now: new Date('2026-11-15T12:00:00Z'),
};

const okBudget = async () => ({
  spentTodayUsd: 0,
  spentMonthUsd: 0,
  dailyLimitUsd: 2,
  monthlyLimitUsd: 50,
});

describe('Roteirista', () => {
  it('system prompt traz a bíblia e as regras (estável, vai para o cache)', () => {
    const sys = writerSystemPrompt(DEFAULT_BIBLE);
    expect(sys).toContain('Zeca Neon');
    expect(sys).toContain('Nunca afirma ser humano');
    expect(sys).toContain('sourceIds');
    expect(sys).not.toMatch(/2026-11-15/); // nada variável no system
  });

  it('modo simulado: roteiro dentro das regras, custo zero com o id do vídeo', async () => {
    const records: LlmCostRecord[] = [];
    const llm = new Llm({
      simulation: true,
      budget: okBudget,
      record: async (c) => void records.push(c),
    });
    const r = await writeScript(llm, input);
    expect(r.script.lines.map((l) => l.kind)).toEqual(['abertura', 'fato', 'opiniao', 'chamada']);
    expect(r.script.lines[1]!.sourceIds).toEqual(['n1']);
    expect(records[0]).toMatchObject({ simulated: true, costUsd: 0, productionId: 'p1' });
  });

  it('rumor simulado usa 2 fontes e diz que é rumor', async () => {
    const llm = new Llm({ simulation: true, budget: okBudget, record: async () => {} });
    const r = await writeScript(llm, { ...input, story: { ...input.story, isRumor: true } });
    const rumor = r.script.lines.find((l) => l.kind === 'rumor')!;
    expect(rumor.sourceIds).toEqual(['n1', 'n2']);
    expect(rumor.text).toMatch(/não confirmado/);
  });

  it('Claude erra (fato sem fonte) → recebe a lista de problemas e corrige na 2ª tentativa', async () => {
    const good = fakeWriterOutput(input);
    // completa a duração (alvo 60 s) com falas de opinião
    const extra = 'Isso muda bastante coisa para quem espera o jogo. '.repeat(5).trim();
    for (const id of [5, 6, 7]) {
      good.lines.push({ id, scene: 3, kind: 'opiniao', text: `[serio] ${extra}`, sourceIds: [] });
    }
    const bad = structuredClone(good);
    bad.lines[1]!.sourceIds = [];
    const parse = vi
      .fn()
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        parsed_output: bad,
        usage: { input_tokens: 10, output_tokens: 10 },
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        parsed_output: good,
        usage: { input_tokens: 10, output_tokens: 10 },
      });
    const llm = new Llm({
      simulation: false,
      client: { messages: { parse: vi.fn() }, beta: { messages: { parse } } } as never,
      budget: okBudget,
      record: async () => {},
    });
    const r = await writeScript(llm, input);
    expect(r.attempts).toBe(2);
    expect(parse.mock.calls[1]![0].messages[0].content).toMatch(/fala 2 \(fato\) sem fonte/);
  });

  it('erra duas vezes → ScriptRejectedError com os problemas', async () => {
    const bad = fakeWriterOutput(input);
    bad.lines[1]!.sourceIds = ['inventada'];
    const parse = vi.fn().mockResolvedValue({
      stop_reason: 'end_turn',
      parsed_output: bad,
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const llm = new Llm({
      simulation: false,
      client: { messages: { parse: vi.fn() }, beta: { messages: { parse } } } as never,
      budget: okBudget,
      record: async () => {},
    });
    await expect(writeScript(llm, input)).rejects.toThrow(ScriptRejectedError);
    expect(parse).toHaveBeenCalledTimes(2);
  });

  it('roteiro com cara de telejornal recebe UMA chance de melhorar o estilo (não bloqueia)', async () => {
    const good = fakeWriterOutput(input);
    const extra = 'Isso muda bastante coisa pra quem espera o jogo, você não acha? '
      .repeat(4)
      .trim();
    for (const id of [5, 6, 7]) {
      good.lines.push({ id, scene: 3, kind: 'opiniao', text: `[serio] ${extra}`, sourceIds: [] });
    }
    const jornal = structuredClone(good);
    jornal.lines[1]!.text = '[neutro] De acordo com a Rockstar, nesta quinta-feira saiu a data.';
    const reply = (out: unknown) => ({
      stop_reason: 'end_turn',
      parsed_output: out,
      usage: { input_tokens: 10, output_tokens: 10 },
    });
    const parse = vi.fn().mockResolvedValueOnce(reply(jornal)).mockResolvedValueOnce(reply(jornal));
    const llm = new Llm({
      simulation: false,
      client: { messages: { parse: vi.fn() }, beta: { messages: { parse } } } as never,
      budget: okBudget,
      record: async () => {},
    });
    const r = await writeScript(llm, input);
    expect(r.attempts).toBe(2);
    expect(parse.mock.calls[1]![0].messages[0].content).toMatch(/estilo: tom de telejornal/);
    expect(r.styleNotes.join(' ')).toMatch(/telejornal/);
  });
});

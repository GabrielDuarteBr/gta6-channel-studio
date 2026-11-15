import { describe, expect, it } from 'vitest';
import { createTtsProvider, FakeTts, ProviderError, type FetchLike } from '../src';

describe('voz de teste (espeak no worker-media)', () => {
  it('chama a rota fechada e devolve duração e custo zero', async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fake: FetchLike = async (url, init) => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ path: 'clips/x/s0.wav', duration_sec: 1.25 }));
    };
    const tts = createTtsProvider('fake', {
      mediaUrl: 'http://worker-media:4300',
      fetchImpl: fake,
    });
    expect(tts.real).toBe(false);
    const res = await tts.synthesize({ text: 'Fala, galera!', out: 'clips/x/s0.wav' });
    expect(res).toEqual({
      path: 'clips/x/s0.wav',
      durationSec: 1.25,
      chars: 13,
      costUsd: 0,
      provider: 'fake',
    });
    expect(calls[0]).toEqual({
      url: 'http://worker-media:4300/tts/espeak',
      body: { text: 'Fala, galera!', out: 'clips/x/s0.wav', voice: 'pt-br' },
    });
  });

  it('erro do worker vira mensagem clara', async () => {
    const fake: FetchLike = async () =>
      new Response(JSON.stringify({ error: 'texto vazio' }), { status: 400 });
    await expect(
      new FakeTts('http://m', fake).synthesize({ text: '', out: 'a.wav' }),
    ).rejects.toThrow(new ProviderError('voz de teste falhou: texto vazio'));
  });
});

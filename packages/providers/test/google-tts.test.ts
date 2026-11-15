import { describe, expect, it } from 'vitest';
import {
  CachedTts,
  createTtsProvider,
  explainGoogleError,
  GoogleTts,
  listGoogleChirpVoices,
  ProviderError,
  type AudioStore,
  type FetchLike,
} from '../src';

/** WAV PCM mínimo (cabeçalho + 0,1 s de silêncio a 24 kHz). */
function wav(): Buffer {
  const rate = 24000;
  const data = rate * 0.1 * 2;
  const b = Buffer.alloc(44 + data);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + data, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(data, 40);
  return b;
}

/** Pasta de trabalho em memória. */
function memoryStore() {
  const files = new Map<string, Uint8Array>();
  const store: AudioStore = {
    importWav: async (out, data) => {
      files.set(out, data);
      return { path: out, durationSec: 0.1 };
    },
    info: async (path) =>
      files.has(path) ? { exists: true, durationSec: 0.1 } : { exists: false },
  };
  return { files, store };
}

function fakeGoogle() {
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify({ audioContent: wav().toString('base64') }));
  };
  return { calls, fetchImpl };
}

const voice = 'pt-BR-Chirp3-HD-Charon';

describe('voz do Google (Chirp 3 HD)', () => {
  it('pede LINEAR16 com a voz e a velocidade, chave no cabeçalho (nunca na URL)', async () => {
    const g = fakeGoogle();
    const { files, store } = memoryStore();
    const tts = new GoogleTts({
      apiKey: 'AIza-teste',
      voice,
      speakingRate: 1.05,
      store,
      fetchImpl: g.fetchImpl,
    });
    const res = await tts.synthesize({ text: '  Fala, galera do Radar!  ', out: 'clips/x/t0.wav' });
    expect(g.calls[0]).toMatchObject({
      url: 'https://texttospeech.googleapis.com/v1/text:synthesize',
      headers: { 'x-goog-api-key': 'AIza-teste' },
      body: {
        input: { text: 'Fala, galera do Radar!' },
        voice: { languageCode: 'pt-BR', name: voice },
        audioConfig: { audioEncoding: 'LINEAR16', speakingRate: 1.05 },
      },
    });
    expect(g.calls[0]!.url).not.toContain('AIza');
    expect(files.get('clips/x/t0.wav')?.subarray(0, 4).toString()).toBe('RIFF');
    expect(res).toMatchObject({ provider: 'google', chars: 22, durationSec: 0.1 });
    expect(res.costUsd).toBeCloseTo((22 * 30) / 1_000_000, 10);
  });

  it('a trava (cota grátis / teto) roda antes de gastar e pode impedir a chamada', async () => {
    const g = fakeGoogle();
    const { store } = memoryStore();
    const seen: number[] = [];
    const tts = new GoogleTts({
      apiKey: 'k',
      voice,
      speakingRate: 1,
      store,
      fetchImpl: g.fetchImpl,
      guard: async (chars) => {
        seen.push(chars);
        if (chars > 10) throw new ProviderError('cota grátis do mês quase no fim');
      },
    });
    await tts.synthesize({ text: 'oi Zeca', out: 'a.wav' });
    await expect(tts.synthesize({ text: 'texto comprido demais', out: 'b.wav' })).rejects.toThrow(
      /cota/,
    );
    expect(seen).toEqual([7, 21]);
    expect(g.calls).toHaveLength(1);
  });

  it('cache: o mesmo trecho com a mesma voz não é pago de novo', async () => {
    const g = fakeGoogle();
    const { store } = memoryStore();
    const tts = new CachedTts(
      new GoogleTts({ apiKey: 'k', voice, speakingRate: 1, store, fetchImpl: g.fetchImpl }),
      store,
    );
    const a = await tts.synthesize({ text: 'Isso é rumor, hein!', out: 'ignorado.wav' });
    const b = await tts.synthesize({ text: 'Isso é rumor, hein!', out: 'outro.wav' });
    expect(a.path).toMatch(/^tts-cache\/google\/[0-9a-f]{32}\.wav$/);
    expect(b).toMatchObject({ path: a.path, costUsd: 0, cached: true });
    expect(g.calls).toHaveLength(1);
    const c = new CachedTts(
      new GoogleTts({ apiKey: 'k', voice, speakingRate: 1.2, store, fetchImpl: g.fetchImpl }),
      store,
    );
    expect(c.cachePath('Isso é rumor, hein!')).not.toBe(a.path); // outra velocidade, outro áudio
  });

  it('recusa voz fora do padrão Chirp 3 HD, velocidade fora da faixa e trecho grande', async () => {
    const { store } = memoryStore();
    expect(
      () => new GoogleTts({ apiKey: 'k', voice: 'pt-BR-Wavenet-A', speakingRate: 1, store }),
    ).toThrow(/voz/);
    expect(() => new GoogleTts({ apiKey: 'k', voice, speakingRate: 3, store })).toThrow(
      /velocidade/,
    );
    const tts = new GoogleTts({
      apiKey: 'k',
      voice,
      speakingRate: 1,
      store,
      fetchImpl: fakeGoogle().fetchImpl,
    });
    await expect(tts.synthesize({ text: 'á'.repeat(3000), out: 'a.wav' })).rejects.toThrow(
      /grande demais/,
    );
  });

  it('erros do Google viram mensagens claras, sem a chave', () => {
    const body = (status: string, reason: string) => ({ error: { status, details: [{ reason }] } });
    expect(explainGoogleError(400, body('INVALID_ARGUMENT', 'API_KEY_INVALID'))).toMatch(
      /chave do Google inválida/,
    );
    expect(explainGoogleError(403, body('PERMISSION_DENIED', 'SERVICE_DISABLED'))).toMatch(
      /não está ativada/,
    );
    expect(explainGoogleError(403, body('PERMISSION_DENIED', 'BILLING_DISABLED'))).toMatch(
      /faturamento/,
    );
    expect(explainGoogleError(403, body('PERMISSION_DENIED', 'API_KEY_SERVICE_BLOCKED'))).toMatch(
      /restrita/,
    );
    expect(explainGoogleError(429, {})).toMatch(/limite/);
  });

  it('limite momentâneo (429) e servidor fora (5xx) podem tentar de novo; chave inválida não', async () => {
    const respond =
      (status: number, body: unknown): FetchLike =>
      async () =>
        new Response(JSON.stringify(body), { status });
    const attempt = async (fetchImpl: FetchLike) => {
      const tts = new GoogleTts({
        apiKey: 'AIza-chave-de-teste',
        voice,
        speakingRate: 1,
        store: memoryStore().store,
        fetchImpl,
      });
      return tts.synthesize({ text: 'Fala, galera!', out: 'a.wav' }).catch((e: unknown) => e);
    };
    const limited = await attempt(respond(429, { error: { status: 'RESOURCE_EXHAUSTED' } }));
    expect(limited).toBeInstanceOf(ProviderError);
    expect((limited as ProviderError).retryable).toBe(true);
    expect(((await attempt(respond(503, {}))) as ProviderError).retryable).toBe(true);
    const invalid = await attempt(
      respond(400, {
        error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] },
      }),
    );
    expect((invalid as ProviderError).retryable).toBe(false);
    expect((invalid as ProviderError).message).not.toContain('AIza-chave-de-teste');
  });

  it('sem chave, o Google não é escolhido (mensagem diz o que configurar)', () => {
    expect(() =>
      createTtsProvider('google', { mediaUrl: 'http://m', google: { voice, speakingRate: 1 } }),
    ).toThrow(/GOOGLE_TTS_API_KEY/);
  });

  it('lista só as vozes Chirp 3 HD do idioma, vindas da API', async () => {
    const fetchImpl: FetchLike = async (url, init) => {
      expect(url).toBe('https://texttospeech.googleapis.com/v1/voices?languageCode=pt-BR');
      expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe('k');
      return new Response(
        JSON.stringify({
          voices: [
            { name: 'pt-BR-Chirp3-HD-Puck', ssmlGender: 'MALE' },
            { name: 'pt-BR-Chirp3-HD-Aoede', ssmlGender: 'FEMALE' },
            { name: 'pt-BR-Neural2-B', ssmlGender: 'MALE' },
            { name: 'pt-PT-Chirp3-HD-Puck', ssmlGender: 'MALE' },
          ],
        }),
      );
    };
    expect(await listGoogleChirpVoices('k', 'pt-BR', fetchImpl)).toEqual([
      { name: 'pt-BR-Chirp3-HD-Aoede', gender: 'FEMALE' },
      { name: 'pt-BR-Chirp3-HD-Puck', gender: 'MALE' },
    ]);
  });
});

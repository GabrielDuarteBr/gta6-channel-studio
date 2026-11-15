import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { ProviderError } from '../src';
import {
  createImageProvider,
  FakeImageProvider,
  GoogleImageProvider,
  ImageBlockedError,
  imagePriceUsd,
  listGoogleImageModels,
  synthwavePng,
  type FetchLike,
} from '../src';

function capture(response: unknown, status = 200) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    return new Response(JSON.stringify(response), { status });
  };
  return { calls, fetchImpl };
}

const PNG_B64 = Buffer.from(synthwavePng(64, 36, 'x')).toString('base64');

describe('imagens do Google', () => {
  it('Imagen: predict com proporção, sem pessoas, chave no cabeçalho', async () => {
    const { calls, fetchImpl } = capture({
      predictions: [{ bytesBase64Encoded: PNG_B64, mimeType: 'image/png' }],
    });
    const p = new GoogleImageProvider('AIza-teste', 'imagen-4.0-fast-generate-001', fetchImpl);
    const r = await p.generate({ prompt: 'Neon city at dusk', aspectRatio: '16:9' });
    expect(calls[0]!.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict',
    );
    expect(calls[0]!.url).not.toContain('AIza');
    expect(calls[0]!.headers['x-goog-api-key']).toBe('AIza-teste');
    expect(calls[0]!.body).toEqual({
      instances: [{ prompt: 'Neon city at dusk' }],
      parameters: { sampleCount: 1, aspectRatio: '16:9', personGeneration: 'dont_allow' },
    });
    expect(r).toMatchObject({ mime: 'image/png', costUsd: 0.02 });
    expect(r.bytes[0]).toBe(0x89);
  });

  it('Gemini de imagem: generateContent com responseModalities IMAGE e imageConfig', async () => {
    const { calls, fetchImpl } = capture({
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ inlineData: { data: PNG_B64, mimeType: 'image/png' } }] },
        },
      ],
    });
    const p = new GoogleImageProvider('k', 'gemini-3.1-flash-image-preview', fetchImpl);
    const r = await p.generate({ prompt: 'Palm trees', aspectRatio: '9:16' });
    expect(calls[0]!.url).toMatch(/:generateContent$/);
    expect(calls[0]!.body).toMatchObject({
      generationConfig: {
        responseModalities: ['IMAGE'],
        imageConfig: { aspectRatio: '9:16', imageSize: '1K' },
      },
    });
    expect(r.costUsd).toBe(0.067);
  });

  it('filtro de segurança vira ImageBlockedError; 429 pode repetir; chave inválida não', async () => {
    await expect(
      new GoogleImageProvider(
        'k',
        'imagen-4.0-generate-001',
        capture({ predictions: [] }).fetchImpl,
      ).generate({
        prompt: 'x y z w',
        aspectRatio: '16:9',
      }),
    ).rejects.toThrow(ImageBlockedError);
    await expect(
      new GoogleImageProvider(
        'k',
        'gemini-3.1-flash-image-preview',
        capture({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] })
          .fetchImpl,
      ).generate({ prompt: 'x', aspectRatio: '16:9' }),
    ).rejects.toThrow(/IMAGE_SAFETY/);
    const limited = await new GoogleImageProvider(
      'k',
      'imagen-4.0-fast-generate-001',
      capture({ error: { status: 'RESOURCE_EXHAUSTED' } }, 429).fetchImpl,
    )
      .generate({ prompt: 'x', aspectRatio: '16:9' })
      .then(
        () => null,
        (e: unknown) => e as ProviderError,
      );
    expect(limited?.retryable).toBe(true);
    const invalid = await new GoogleImageProvider(
      'k',
      'imagen-4.0-fast-generate-001',
      capture(
        { error: { status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } },
        400,
      ).fetchImpl,
    )
      .generate({ prompt: 'x', aspectRatio: '16:9' })
      .then(
        () => null,
        (e: unknown) => e as ProviderError,
      );
    expect(invalid?.retryable).toBe(false);
    expect(invalid?.message).toMatch(/GEMINI_API_KEY/);
  });

  it('lista só modelos de imagem da chave, do mais barato ao mais caro', async () => {
    const { fetchImpl } = capture({
      models: [
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/imagen-4.0-ultra-generate-001', supportedGenerationMethods: ['predict'] },
        { name: 'models/imagen-4.0-fast-generate-001', supportedGenerationMethods: ['predict'] },
        {
          name: 'models/gemini-3.1-flash-image-preview',
          supportedGenerationMethods: ['generateContent'],
        },
        { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
      ],
    });
    const models = await listGoogleImageModels('k', fetchImpl);
    expect(models.map((m) => [m.id, m.priceUsd])).toEqual([
      ['imagen-4.0-fast-generate-001', 0.02],
      ['imagen-4.0-ultra-generate-001', 0.06],
      ['gemini-3.1-flash-image-preview', 0.067],
    ]);
  });

  it('preços aproximados por família de modelo', () => {
    expect(imagePriceUsd('imagen-4.0-generate-001')).toBe(0.04);
    expect(imagePriceUsd('gemini-3.1-flash-lite-image')).toBe(0.034);
    expect(imagePriceUsd('gemini-3-pro-image-preview')).toBe(0.134);
  });
});

describe('imagem falsa', () => {
  it('PNG válido, determinístico e diferente para prompts diferentes', async () => {
    const a = synthwavePng(320, 180, 'cidade');
    const b = synthwavePng(320, 180, 'cidade');
    const c = synthwavePng(320, 180, 'praia');
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false);
    // IDAT descomprime no tamanho certo (linhas com byte de filtro)
    const buf = Buffer.from(a);
    const idat = buf.indexOf('IDAT');
    const len = buf.readUInt32BE(idat - 4);
    expect(inflateSync(buf.subarray(idat + 4, idat + 4 + len)).length).toBe((320 * 3 + 1) * 180);
    const r = await new FakeImageProvider().generate({ prompt: 'x', aspectRatio: '9:16' });
    expect(r.costUsd).toBe(0);
    expect(Buffer.from(r.bytes).readUInt32BE(16)).toBe(720);
  });

  it('Google sem chave não é criado', () => {
    expect(() => createImageProvider('google', { model: 'imagen-4.0-fast-generate-001' })).toThrow(
      /GEMINI_API_KEY/,
    );
  });
});

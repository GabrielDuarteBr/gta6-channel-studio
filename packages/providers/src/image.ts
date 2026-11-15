import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { z } from 'zod';
import { explainGoogleError } from './google-tts';
import { isTransientStatus, ProviderError, type FetchLike } from './tts';

/**
 * Imagens geradas (Diretor de arte). Google pela Gemini API (mesmo projeto e faturamento do
 * Google Cloud da voz): modelos "imagen-*" usam `models.predict`; modelos Gemini de imagem
 * ("Nano Banana", "*-image*") usam `models.generateContent` com responseModalities IMAGE.
 * Endpoints, `imageConfig.aspectRatio/imageSize`, `inlineData` e os motivos de bloqueio
 * (IMAGE_SAFETY...) conferidos no documento de descoberta oficial (v1beta, rev. 20261113).
 * O corpo do Imagen (instances[].prompt, parameters) segue a documentação do Imagen; o
 * `make imagens` testa de verdade com a sua chave antes de qualquer vídeo.
 */

export const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_API_NAME = 'Generative Language API (Gemini)';
export const GEMINI_ENV = 'GEMINI_API_KEY';

export type AspectRatio = '16:9' | '9:16' | '1:1';

export interface ImageRequest {
  prompt: string;
  aspectRatio: AspectRatio;
}

export interface ImageResult {
  bytes: Uint8Array;
  mime: string;
  model: string;
  /** Preço de tabela aproximado desta imagem (US$). */
  costUsd: number;
}

export interface ImageProvider {
  readonly id: 'google' | 'fake';
  readonly label: string;
  readonly real: boolean;
  readonly model: string;
  generate(req: ImageRequest): Promise<ImageResult>;
}

/** A imagem foi recusada pelo filtro de segurança do provedor (não adianta repetir igual). */
export class ImageBlockedError extends ProviderError {
  override name = 'ImageBlockedError';
}

/**
 * Preço aproximado por imagem (1K), de sites de comparação em nov/2026 — a página oficial
 * de preços não abre deste ambiente. Confira no console do Google; o teto de gasto usa isto.
 */
export function imagePriceUsd(model: string): number {
  const m = model.toLowerCase();
  if (m.startsWith('imagen')) {
    if (m.includes('fast')) return 0.02;
    if (m.includes('ultra')) return 0.06;
    return 0.04;
  }
  if (m.includes('pro') && m.includes('image')) return 0.134;
  if (m.includes('lite') && m.includes('image')) return 0.034;
  if (m.includes('flash') && m.includes('image')) return 0.067;
  return 0.07;
}

export const isImagenModel = (model: string) => model.toLowerCase().startsWith('imagen');

const predictSchema = z.object({
  predictions: z
    .array(
      z
        .object({
          bytesBase64Encoded: z.string().optional(),
          mimeType: z.string().optional(),
          raiFilteredReason: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
});

const generateSchema = z.object({
  candidates: z
    .array(
      z
        .object({
          finishReason: z.string().optional(),
          content: z
            .object({
              parts: z
                .array(
                  z
                    .object({
                      inlineData: z.object({ data: z.string(), mimeType: z.string() }).optional(),
                      text: z.string().optional(),
                    })
                    .passthrough(),
                )
                .optional(),
            })
            .optional(),
        })
        .passthrough(),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).passthrough().optional(),
});

export class GoogleImageProvider implements ImageProvider {
  readonly id = 'google' as const;
  readonly real = true;
  readonly label: string;

  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!/^[a-z0-9][a-z0-9.-]{2,80}$/.test(model)) {
      throw new ProviderError(`modelo de imagem inválido: ${model}`);
    }
    this.label = `Google ${model}`;
  }

  private async call(method: 'predict' | 'generateContent', body: unknown): Promise<unknown> {
    const res = await this.fetchImpl(`${GEMINI_API}/models/${this.model}:${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    const data: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ProviderError(
        `imagem do Google falhou: ${explainGoogleError(res.status, data, GEMINI_API_NAME, GEMINI_ENV)}`,
        isTransientStatus(res.status),
      );
    }
    return data;
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    const costUsd = imagePriceUsd(this.model);
    if (isImagenModel(this.model)) {
      const data = predictSchema.parse(
        await this.call('predict', {
          instances: [{ prompt: req.prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: req.aspectRatio,
            personGeneration: 'dont_allow',
          },
        }),
      );
      const p = data.predictions?.[0];
      if (!p?.bytesBase64Encoded) {
        throw new ImageBlockedError(
          `o Google recusou a imagem (filtro de segurança${p?.raiFilteredReason ? `: ${p.raiFilteredReason}` : ''})`,
        );
      }
      return {
        bytes: Buffer.from(p.bytesBase64Encoded, 'base64'),
        mime: p.mimeType ?? 'image/png',
        model: this.model,
        costUsd,
      };
    }
    const data = generateSchema.parse(
      await this.call('generateContent', {
        contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
        generationConfig: {
          responseModalities: ['IMAGE'],
          imageConfig: { aspectRatio: req.aspectRatio, imageSize: '1K' },
        },
      }),
    );
    if (data.promptFeedback?.blockReason) {
      throw new ImageBlockedError(`o Google recusou o pedido (${data.promptFeedback.blockReason})`);
    }
    const cand = data.candidates?.[0];
    const part = cand?.content?.parts?.find((x) => x.inlineData);
    if (!part?.inlineData) {
      throw new ImageBlockedError(
        `o Google não devolveu imagem (${cand?.finishReason ?? 'sem motivo informado'})`,
      );
    }
    return {
      bytes: Buffer.from(part.inlineData.data, 'base64'),
      mime: part.inlineData.mimeType,
      model: this.model,
      costUsd,
    };
  }
}

const modelsSchema = z.object({
  models: z
    .array(
      z.object({
        name: z.string(),
        displayName: z.string().optional(),
        supportedGenerationMethods: z.array(z.string()).optional(),
      }),
    )
    .default([]),
  nextPageToken: z.string().optional(),
});

export interface GoogleImageModel {
  id: string;
  displayName: string;
  method: 'predict' | 'generateContent';
  priceUsd: number;
}

/** Modelos de imagem que a sua chave enxerga (vem da API, não de lista fixa). */
export async function listGoogleImageModels(
  apiKey: string,
  fetchImpl: FetchLike = fetch,
): Promise<GoogleImageModel[]> {
  const out: GoogleImageModel[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
    const res = await fetchImpl(`${GEMINI_API}/models?${qs}`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(30_000),
    });
    const body: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ProviderError(
        `lista de modelos do Google: ${explainGoogleError(res.status, body, GEMINI_API_NAME, GEMINI_ENV)}`,
        isTransientStatus(res.status),
      );
    }
    const data = modelsSchema.parse(body);
    for (const m of data.models) {
      const id = m.name.replace(/^models\//, '');
      const methods = m.supportedGenerationMethods ?? [];
      if (isImagenModel(id) && methods.includes('predict')) {
        out.push({
          id,
          displayName: m.displayName ?? id,
          method: 'predict',
          priceUsd: imagePriceUsd(id),
        });
      } else if (
        /image/i.test(id) &&
        !/embed|edit/i.test(id) &&
        methods.includes('generateContent')
      ) {
        out.push({
          id,
          displayName: m.displayName ?? id,
          method: 'generateContent',
          priceUsd: imagePriceUsd(id),
        });
      }
    }
    pageToken = data.nextPageToken;
    if (!pageToken) break;
  }
  return out.sort((a, b) => a.priceUsd - b.priceUsd || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------
// Imagem falsa (modo simulado e testes): PNG synthwave determinístico, sem rede e sem custo.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const PALETTES: Array<[number[], number[], number[]]> = [
  [
    [255, 61, 139],
    [36, 12, 64],
    [0, 229, 255],
  ],
  [
    [255, 140, 66],
    [40, 10, 70],
    [255, 61, 139],
  ],
  [
    [0, 229, 255],
    [12, 18, 60],
    [178, 102, 255],
  ],
  [
    [255, 200, 87],
    [60, 14, 72],
    [0, 229, 255],
  ],
];

/** Céu em degradê, sol listrado e grade em perspectiva; cores e sol variam com o texto. */
export function synthwavePng(width: number, height: number, seedText: string): Uint8Array {
  const seed = createHash('sha256').update(seedText).digest();
  const [top, bottom, line] = PALETTES[seed[0]! % PALETTES.length]!;
  const horizon = Math.round(height * (0.58 + (seed[1]! / 255) * 0.08));
  const sunX = width * (0.3 + (seed[2]! / 255) * 0.4);
  const sunY = horizon - height * 0.12;
  const sunR = Math.min(width, height) * (0.16 + (seed[3]! / 255) * 0.06);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    const k = Math.min(1, y / horizon);
    for (let x = 0; x < width; x++) {
      let r: number, g: number, b: number;
      if (y < horizon) {
        r = top![0]! * (1 - k) + bottom![0]! * k;
        g = top![1]! * (1 - k) + bottom![1]! * k;
        b = top![2]! * (1 - k) + bottom![2]! * k;
        const d = Math.hypot(x - sunX, y - sunY);
        const stripe = y > sunY && Math.floor((y - sunY) / (sunR / 6)) % 2 === 1;
        if (d < sunR && !stripe) {
          r = 255;
          g = 120 + (110 * (y - (sunY - sunR))) / (2 * sunR);
          b = 90;
        }
      } else {
        const depth = (y - horizon) / (height - horizon);
        r = 14 + 20 * depth;
        g = 8;
        b = 36 + 30 * depth;
        const persp = 1 / Math.max(0.02, depth);
        const hLine = Math.abs(((persp * 4) % 1) - 0.5) < 0.04 * (1 + depth * 3);
        const vx = (x - width / 2) / Math.max(1, (y - horizon) * 1.6);
        const vLine = Math.abs(vx - Math.round(vx)) < 0.02 + depth * 0.02;
        if (hLine || vLine) {
          r = line![0]!;
          g = line![1]!;
          b = line![2]!;
        }
      }
      const i = row + 1 + x * 3;
      raw[i] = Math.max(0, Math.min(255, Math.round(r)));
      raw[i + 1] = Math.max(0, Math.min(255, Math.round(g)));
      raw[i + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 6 })),
    pngChunk('IEND', new Uint8Array()),
  ]);
}

export class FakeImageProvider implements ImageProvider {
  readonly id = 'fake' as const;
  readonly real = false;
  readonly label = 'Imagem de teste (synthwave gerada no estúdio)';
  readonly model = 'fake-synthwave';

  async generate(req: ImageRequest): Promise<ImageResult> {
    const [w, h] =
      req.aspectRatio === '9:16'
        ? [720, 1280]
        : req.aspectRatio === '1:1'
          ? [1024, 1024]
          : [1280, 720];
    return {
      bytes: synthwavePng(w, h, req.prompt),
      mime: 'image/png',
      model: this.model,
      costUsd: 0,
    };
  }
}

export function createImageProvider(
  id: 'google' | 'fake',
  opts: { apiKey?: string | undefined; model: string; fetchImpl?: FetchLike },
): ImageProvider {
  if (id === 'fake') return new FakeImageProvider();
  if (!opts.apiKey) {
    throw new ProviderError('imagens do Google sem chave: configure GEMINI_API_KEY no .env');
  }
  return new GoogleImageProvider(opts.apiKey, opts.model, opts.fetchImpl);
}

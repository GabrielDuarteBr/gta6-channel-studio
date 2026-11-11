/** Busca HTTP com tempo-limite, tamanho máximo e GET condicional (ETag/Last-Modified). */

export const USER_AGENT = 'RadarNeonNewsBot/0.1 (+leitor de feeds para pauta jornalistica)';

export interface FetchTextOptions {
  etag?: string | null | undefined;
  lastModified?: string | null | undefined;
  timeoutMs?: number;
  maxBytes?: number;
  accept?: string;
}

export interface FetchTextResult {
  status: number;
  notModified: boolean;
  body: string;
  etag?: string | undefined;
  lastModified?: string | undefined;
  finalUrl: string;
  contentType: string;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  override name = 'HttpError';
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function fetchText(
  url: string,
  options: FetchTextOptions = {},
  fetchImpl: FetchLike = fetch,
): Promise<FetchTextResult> {
  const headers: Record<string, string> = {
    'user-agent': USER_AGENT,
    accept:
      options.accept ??
      'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5',
  };
  if (options.etag) headers['if-none-match'] = options.etag;
  if (options.lastModified) headers['if-modified-since'] = options.lastModified;

  const res = await fetchImpl(url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000),
  });
  const base = {
    status: res.status,
    etag: res.headers.get('etag') ?? undefined,
    lastModified: res.headers.get('last-modified') ?? undefined,
    finalUrl: res.url || url,
    contentType: res.headers.get('content-type') ?? '',
  };
  if (res.status === 304) return { ...base, notModified: true, body: '' };
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} em ${url}`);

  const max = options.maxBytes ?? 5_000_000;
  const reader = res.body?.getReader();
  if (!reader) return { ...base, notModified: false, body: await res.text() };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      throw new HttpError(413, `resposta maior que ${max} bytes em ${url}`);
    }
    chunks.push(value);
  }
  const body = new TextDecoder('utf-8').decode(Buffer.concat(chunks));
  return { ...base, notModified: false, body };
}

import { open, stat } from 'node:fs/promises';
import { isTransientStatus, ProviderError, type FetchLike } from './tts';

/**
 * YouTube para publicar e medir (Fase 5/6), conferido nos documentos de descoberta oficiais
 * (youtube v3, youtubeAnalytics v2) e na configuração OpenID do Google:
 * - OAuth 2.0 (servidor web): accounts.google.com/o/oauth2/v2/auth → oauth2.googleapis.com/token,
 *   access_type=offline para receber o refresh token (guardado cifrado no banco).
 * - Envio resumable: POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status →
 *   cabeçalho Location (sessão) → PUT em pedaços com Content-Range; 308 = continua; a sessão
 *   sobrevive a reinícios (status com Content-Range: bytes * /total).
 * - status: privacyStatus "private" + publishAt (só vale com privado), selfDeclaredMadeForKids,
 *   containsSyntheticMedia (regra 7).
 */

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
] as const;

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';
const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';
/** Pedaços múltiplos de 256 KiB (exigência do protocolo resumable). */
export const CHUNK_BYTES = 8 * 1024 * 1024;

export class YouTubeError extends ProviderError {
  override name = 'YouTubeError';
  constructor(
    message: string,
    retryable: boolean,
    readonly status = 0,
    readonly reason = '',
  ) {
    super(message, retryable);
  }
}

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Link da tela de consentimento do Google (o dono entra com a conta do canal). */
export function youtubeAuthUrl(client: OAuthClient, state: string): string {
  const u = new URL(AUTH_URL);
  u.searchParams.set('client_id', client.clientId);
  u.searchParams.set('redirect_uri', client.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', YOUTUBE_SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  return u.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | undefined;
  expiresAt: Date;
  scopes: string[];
}

async function tokenRequest(fetchImpl: FetchLike, body: Record<string, string>): Promise<TokenSet> {
  const res = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !data.access_token) {
    const reason = data.error ?? `HTTP ${res.status}`;
    throw new YouTubeError(
      reason === 'invalid_grant'
        ? 'O Google recusou a autorização (revogada ou expirada). Conecte o YouTube de novo em Configurações.'
        : `Google OAuth: ${reason}${data.error_description ? ` (${data.error_description})` : ''}`,
      isTransientStatus(res.status),
      res.status,
      reason,
    );
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    scopes: (data.scope ?? '').split(' ').filter(Boolean),
  };
}

export function exchangeCode(
  client: OAuthClient,
  code: string,
  fetchImpl: FetchLike = fetch,
): Promise<TokenSet> {
  return tokenRequest(fetchImpl, {
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: client.redirectUri,
    grant_type: 'authorization_code',
  });
}

export function refreshAccessToken(
  client: Omit<OAuthClient, 'redirectUri'>,
  refreshToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<TokenSet> {
  return tokenRequest(fetchImpl, {
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: 'refresh_token',
  });
}

/** Revoga a autorização no Google ao desconectar (o token também sai do banco). */
export async function revokeToken(token: string, fetchImpl: FetchLike = fetch): Promise<boolean> {
  const res = await fetchImpl('https://oauth2.googleapis.com/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  return Boolean(res?.ok);
}

export interface VideoMetadata {
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  publishAt: Date;
  defaultLanguage?: string;
}

/** Corpo do videos.insert: SEMPRE privado com data marcada e marca de conteúdo sintético. */
export function insertBody(meta: VideoMetadata) {
  return {
    snippet: {
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      categoryId: meta.categoryId,
      defaultLanguage: meta.defaultLanguage ?? 'pt-BR',
      defaultAudioLanguage: meta.defaultLanguage ?? 'pt-BR',
    },
    status: {
      privacyStatus: 'private',
      publishAt: meta.publishAt.toISOString(),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    },
  };
}

export type QuotaRecorder = (bucket: string, method: string, units: number) => Promise<void> | void;

export interface ChannelInfo {
  id: string;
  title: string;
  handle?: string | undefined;
}

export interface UploadProgress {
  uploadedBytes: number;
  totalBytes: number;
}

async function readChunk(path: string, start: number, length: number): Promise<Buffer> {
  const fh = await open(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

async function apiError(res: Response, what: string): Promise<YouTubeError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; errors?: Array<{ reason?: string }> };
  };
  const reason = body.error?.errors?.[0]?.reason ?? `HTTP ${res.status}`;
  const hints: Record<string, string> = {
    quotaExceeded: 'a cota diária do YouTube acabou; volta à meia-noite do Pacífico',
    uploadLimitExceeded: 'o canal passou do limite de envios do dia',
    forbidden: 'a conta conectada não pode enviar para este canal',
    youtubeSignupRequired: 'a conta do Google não tem canal no YouTube',
  };
  return new YouTubeError(
    `${what}: ${hints[reason] ?? body.error?.message ?? reason}`,
    isTransientStatus(res.status),
    res.status,
    reason,
  );
}

export class YouTubePublisher {
  constructor(
    private readonly accessToken: () => Promise<string>,
    private readonly recordQuota: QuotaRecorder = () => undefined,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async auth(): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await this.accessToken()}` };
  }

  /** Canal da conta conectada (channels.list mine=true, 1 unidade). */
  async myChannel(): Promise<ChannelInfo> {
    const res = await this.fetchImpl(`${API}/channels?part=snippet&mine=true`, {
      headers: await this.auth(),
      signal: AbortSignal.timeout(20_000),
    });
    await this.recordQuota('default', 'channels.list', 1);
    if (!res.ok) throw await apiError(res, 'Canal do YouTube');
    const data = (await res.json()) as {
      items?: Array<{ id: string; snippet?: { title?: string; customUrl?: string } }>;
    };
    const ch = data.items?.[0];
    if (!ch) throw new YouTubeError('A conta conectada não tem canal no YouTube.', false);
    return { id: ch.id, title: ch.snippet?.title ?? ch.id, handle: ch.snippet?.customUrl };
  }

  /** Abre a sessão de envio resumable e devolve o endereço da sessão. */
  async startUpload(
    meta: VideoMetadata,
    totalBytes: number,
    mime: string,
    notifySubscribers = true,
  ) {
    const url = `${UPLOAD}/videos?uploadType=resumable&part=snippet,status&notifySubscribers=${notifySubscribers}`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        ...(await this.auth()),
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(totalBytes),
        'x-upload-content-type': mime,
      },
      body: JSON.stringify(insertBody(meta)),
      signal: AbortSignal.timeout(30_000),
    });
    await this.recordQuota('videos.insert', 'videos.insert', 1);
    if (!res.ok) throw await apiError(res, 'Envio ao YouTube');
    const location = res.headers.get('location');
    if (!location) throw new YouTubeError('O YouTube não devolveu a sessão de envio.', true);
    return location;
  }

  /** Quantos bytes a sessão já recebeu (ou o id do vídeo, se o envio já terminou). */
  async uploadStatus(
    uploadUri: string,
    totalBytes: number,
  ): Promise<{ next: number; videoId?: string }> {
    const res = await this.fetchImpl(uploadUri, {
      method: 'PUT',
      headers: { ...(await this.auth()), 'content-range': `bytes */${totalBytes}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 200 || res.status === 201) {
      const v = (await res.json()) as { id: string };
      return { next: totalBytes, videoId: v.id };
    }
    if (res.status === 308) {
      const range = res.headers.get('range');
      const end = range ? Number(/bytes=0-(\d+)/.exec(range)?.[1] ?? -1) : -1;
      return { next: end + 1 };
    }
    if (res.status === 404 || res.status === 410) {
      throw new YouTubeError(
        'A sessão de envio expirou; o envio recomeça do zero.',
        true,
        res.status,
        'sessionExpired',
      );
    }
    throw await apiError(res, 'Situação do envio');
  }

  /** Envia o arquivo a partir de `from` (retoma) e devolve o id do vídeo. */
  async uploadFile(
    uploadUri: string,
    path: string,
    from = 0,
    onProgress: (p: UploadProgress) => Promise<void> | void = () => undefined,
  ): Promise<string> {
    const totalBytes = (await stat(path)).size;
    let offset = from;
    for (;;) {
      const len = Math.min(CHUNK_BYTES, totalBytes - offset);
      const chunk = await readChunk(path, offset, len);
      const res = await this.fetchImpl(uploadUri, {
        method: 'PUT',
        headers: {
          ...(await this.auth()),
          'content-length': String(chunk.byteLength),
          'content-range': `bytes ${offset}-${offset + chunk.byteLength - 1}/${totalBytes}`,
        },
        body: new Uint8Array(chunk),
        signal: AbortSignal.timeout(10 * 60_000),
      });
      if (res.status === 200 || res.status === 201) {
        const v = (await res.json()) as { id?: string };
        if (!v.id) throw new YouTubeError('O YouTube terminou o envio sem devolver o vídeo.', true);
        await onProgress({ uploadedBytes: totalBytes, totalBytes });
        return v.id;
      }
      if (res.status === 308) {
        const range = res.headers.get('range');
        offset = range ? Number(/bytes=0-(\d+)/.exec(range)?.[1] ?? -1) + 1 : offset;
        await onProgress({ uploadedBytes: offset, totalBytes });
        continue;
      }
      if (isTransientStatus(res.status)) {
        // Servidor instável: pergunta onde parou e continua dali.
        offset = (await this.uploadStatus(uploadUri, totalBytes)).next;
        continue;
      }
      throw await apiError(res, 'Envio ao YouTube');
    }
  }

  /** Thumbnail personalizada (thumbnails.set, 50 unidades). Canal precisa estar verificado. */
  async setThumbnail(videoId: string, bytes: Uint8Array, mime: 'image/png' | 'image/jpeg') {
    const res = await this.fetchImpl(
      `${UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`,
      {
        method: 'POST',
        headers: { ...(await this.auth()), 'content-type': mime },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(60_000),
      },
    );
    await this.recordQuota('default', 'thumbnails.set', 50);
    if (!res.ok) throw await apiError(res, 'Thumbnail');
  }

  /** Situação e números dos vídeos (videos.list, 1 unidade por chamada de até 50). */
  async videos(ids: string[]) {
    if (ids.length === 0) return [];
    const res = await this.fetchImpl(
      `${API}/videos?part=status,statistics&id=${ids.slice(0, 50).map(encodeURIComponent).join(',')}`,
      { headers: await this.auth(), signal: AbortSignal.timeout(20_000) },
    );
    await this.recordQuota('default', 'videos.list', 1);
    if (!res.ok) throw await apiError(res, 'Vídeos do canal');
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        status?: {
          uploadStatus?: string;
          privacyStatus?: string;
          publishAt?: string;
          rejectionReason?: string;
        };
        statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
      }>;
    };
    return (data.items ?? []).map((v) => ({
      id: v.id,
      uploadStatus: v.status?.uploadStatus ?? null,
      privacyStatus: v.status?.privacyStatus ?? null,
      publishAt: v.status?.publishAt ?? null,
      rejectionReason: v.status?.rejectionReason ?? null,
      views: Number(v.statistics?.viewCount ?? 0),
      likes: Number(v.statistics?.likeCount ?? 0),
      comments: Number(v.statistics?.commentCount ?? 0),
    }));
  }

  /** Relatório do YouTube Analytics (reports.query, ids=channel==MINE). */
  async analytics(q: {
    startDate: string;
    endDate: string;
    metrics: string[];
    dimensions?: string[];
    filters?: string;
    sort?: string;
    maxResults?: number;
  }): Promise<Array<Record<string, string | number>>> {
    const u = new URL(ANALYTICS);
    u.searchParams.set('ids', 'channel==MINE');
    u.searchParams.set('startDate', q.startDate);
    u.searchParams.set('endDate', q.endDate);
    u.searchParams.set('metrics', q.metrics.join(','));
    if (q.dimensions?.length) u.searchParams.set('dimensions', q.dimensions.join(','));
    if (q.filters) u.searchParams.set('filters', q.filters);
    if (q.sort) u.searchParams.set('sort', q.sort);
    if (q.maxResults) u.searchParams.set('maxResults', String(q.maxResults));
    const res = await this.fetchImpl(u.toString(), {
      headers: await this.auth(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw await apiError(res, 'YouTube Analytics');
    const data = (await res.json()) as {
      columnHeaders?: Array<{ name: string }>;
      rows?: Array<Array<string | number>>;
    };
    const names = (data.columnHeaders ?? []).map((c) => c.name);
    return (data.rows ?? []).map((row) =>
      Object.fromEntries(row.map((v, i) => [names[i] ?? `c${i}`, v])),
    );
  }
}

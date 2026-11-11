import { z } from 'zod';
import type { FetchLike } from './http';
import { USER_AGENT } from './http';

/**
 * YouTube Data API v3 — SOMENTE METADADOS (Regra 1: nunca baixar vídeo/áudio/imagem).
 * Custos usados (confira a tabela oficial antes de mudar): channels/playlistItems/videos
 * = 1 unidade no balde padrão; search.list consome o balde próprio de buscas.
 */
export type QuotaBucket = 'default' | 'search.list';
export type QuotaRecorder = (
  bucket: QuotaBucket,
  method: string,
  units: number,
) => Promise<void> | void;

const API = 'https://www.googleapis.com/youtube/v3';

const channelsSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        snippet: z.object({ title: z.string() }).partial().optional(),
        contentDetails: z.object({ relatedPlaylists: z.object({ uploads: z.string() }) }),
      }),
    )
    .optional(),
});

const playlistItemsSchema = z.object({
  items: z
    .array(
      z.object({
        snippet: z.object({
          title: z.string(),
          description: z.string().optional(),
          channelTitle: z.string().optional(),
          publishedAt: z.string().optional(),
          resourceId: z.object({ videoId: z.string() }),
        }),
        contentDetails: z.object({ videoPublishedAt: z.string().optional() }).optional(),
      }),
    )
    .default([]),
});

const videosSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string(),
        statistics: z
          .object({
            viewCount: z.string().optional(),
            likeCount: z.string().optional(),
            commentCount: z.string().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});

const searchSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.object({ videoId: z.string().optional() }),
        snippet: z.object({
          title: z.string(),
          description: z.string().optional(),
          channelTitle: z.string().optional(),
          publishedAt: z.string().optional(),
        }),
      }),
    )
    .default([]),
});

export interface YouTubeVideo {
  videoId: string;
  title: string;
  description?: string | undefined;
  channelTitle?: string | undefined;
  publishedAt?: Date | undefined;
  views?: number | undefined;
  likes?: number | undefined;
  comments?: number | undefined;
}

export class YouTubeApiError extends Error {
  override name = 'YouTubeApiError';
  constructor(
    public readonly status: number,
    public readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

/** Decodifica entidades HTML simples que a API devolve nos títulos (&amp; &#39;). */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

export class YouTubeClient {
  constructor(
    private readonly apiKey: string,
    private readonly recordQuota: QuotaRecorder,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async get<T>(
    method: string,
    params: Record<string, string>,
    schema: z.ZodType<T>,
    bucket: QuotaBucket,
  ): Promise<T> {
    const url = new URL(`${API}/${method}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set('key', this.apiKey);
    const res = await this.fetchImpl(url.toString(), {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    // A cota é consumida mesmo quando a chamada falha.
    await this.recordQuota(bucket, `${method}.list`, 1);
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; errors?: Array<{ reason?: string }> };
    };
    if (!res.ok) {
      const reason = body.error?.errors?.[0]?.reason ?? 'unknown';
      throw new YouTubeApiError(
        res.status,
        reason,
        `YouTube ${method}: ${reason} (HTTP ${res.status})`,
      );
    }
    return schema.parse(body);
  }

  /** @handle → id do canal e playlist de uploads (1 unidade). */
  async resolveHandle(
    handle: string,
  ): Promise<{ channelId: string; uploadsPlaylistId: string; title?: string | undefined } | null> {
    const data = await this.get(
      'channels',
      { part: 'contentDetails,snippet', forHandle: handle.startsWith('@') ? handle : `@${handle}` },
      channelsSchema,
      'default',
    );
    const ch = data.items?.[0];
    if (!ch) return null;
    return {
      channelId: ch.id,
      uploadsPlaylistId: ch.contentDetails.relatedPlaylists.uploads,
      title: ch.snippet?.title,
    };
  }

  /** Últimos envios de um canal (1 unidade) + estatísticas (1 unidade). */
  async recentUploads(uploadsPlaylistId: string, max = 10): Promise<YouTubeVideo[]> {
    const data = await this.get(
      'playlistItems',
      { part: 'snippet,contentDetails', playlistId: uploadsPlaylistId, maxResults: String(max) },
      playlistItemsSchema,
      'default',
    );
    const videos: YouTubeVideo[] = data.items.map((i) => ({
      videoId: i.snippet.resourceId.videoId,
      title: decodeEntities(i.snippet.title),
      description: i.snippet.description,
      channelTitle: i.snippet.channelTitle,
      publishedAt: new Date(
        i.contentDetails?.videoPublishedAt ?? i.snippet.publishedAt ?? Date.now(),
      ),
    }));
    return this.withStats(videos);
  }

  /** Busca recente (balde caro de buscas — use com parcimônia) + estatísticas. */
  async searchRecent(query: string, publishedAfter: Date, max = 15): Promise<YouTubeVideo[]> {
    const data = await this.get(
      'search',
      {
        part: 'snippet',
        q: query,
        type: 'video',
        order: 'viewCount',
        publishedAfter: publishedAfter.toISOString(),
        maxResults: String(max),
      },
      searchSchema,
      'search.list',
    );
    const videos: YouTubeVideo[] = data.items
      .filter((i) => i.id.videoId)
      .map((i) => ({
        videoId: i.id.videoId as string,
        title: decodeEntities(i.snippet.title),
        description: i.snippet.description,
        channelTitle: i.snippet.channelTitle,
        publishedAt: i.snippet.publishedAt ? new Date(i.snippet.publishedAt) : undefined,
      }));
    return this.withStats(videos);
  }

  private async withStats(videos: YouTubeVideo[]): Promise<YouTubeVideo[]> {
    if (videos.length === 0) return videos;
    const stats = await this.get(
      'videos',
      { part: 'statistics', id: videos.map((v) => v.videoId).join(','), maxResults: '50' },
      videosSchema,
      'default',
    );
    const byId = new Map(stats.items.map((s) => [s.id, s.statistics]));
    return videos.map((v) => {
      const s = byId.get(v.videoId);
      return {
        ...v,
        views: s?.viewCount ? Number(s.viewCount) : undefined,
        likes: s?.likeCount ? Number(s.likeCount) : undefined,
        comments: s?.commentCount ? Number(s.commentCount) : undefined,
      };
    });
  }
}

/** Link do vídeo para a pauta (só o link; nada é baixado). */
export const youtubeWatchUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

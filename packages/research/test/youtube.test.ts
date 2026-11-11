import { describe, expect, it } from 'vitest';
import { YouTubeApiError, YouTubeClient, youtubeWatchUrl, type FetchLike } from '../src';

function fakeApi(): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = new URL(input);
    calls.push(url.pathname.split('/').pop() ?? '');
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    switch (url.pathname.split('/').pop()) {
      case 'channels':
        return json({
          items: [
            {
              id: 'UC1',
              snippet: { title: 'Rockstar Games' },
              contentDetails: { relatedPlaylists: { uploads: 'UU1' } },
            },
          ],
        });
      case 'playlistItems':
        return json({
          items: [
            {
              snippet: {
                title: 'Grand Theft Auto VI Trailer 3',
                publishedAt: '2026-11-09T14:00:00Z',
                resourceId: { videoId: 'v1' },
              },
              contentDetails: { videoPublishedAt: '2026-11-09T14:00:00Z' },
            },
          ],
        });
      case 'videos':
        return json({
          items: [{ id: 'v1', statistics: { viewCount: '12345678', likeCount: '900000' } }],
        });
      case 'search':
        return json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403);
      default:
        return json({}, 404);
    }
  };
  return { fetch: fetchImpl, calls };
}

describe('YouTubeClient (só metadados)', () => {
  it('resolve @handle, lista envios e soma estatísticas, registrando a cota', async () => {
    const api = fakeApi();
    const quota: string[] = [];
    const yt = new YouTubeClient(
      'chave-teste',
      (b, m, u) => void quota.push(`${b}:${m}:${u}`),
      api.fetch,
    );
    const ch = await yt.resolveHandle('@RockstarGames');
    expect(ch).toEqual({ channelId: 'UC1', uploadsPlaylistId: 'UU1', title: 'Rockstar Games' });
    const videos = await yt.recentUploads('UU1');
    expect(videos[0]).toMatchObject({
      videoId: 'v1',
      title: 'Grand Theft Auto VI Trailer 3',
      views: 12345678,
    });
    expect(quota).toEqual([
      'default:channels.list:1',
      'default:playlistItems.list:1',
      'default:videos.list:1',
    ]);
    expect(youtubeWatchUrl('v1')).toBe('https://www.youtube.com/watch?v=v1');
  });

  it('busca usa o balde de buscas e erros da API viram YouTubeApiError (cota contada mesmo assim)', async () => {
    const api = fakeApi();
    const quota: string[] = [];
    const yt = new YouTubeClient('chave-teste', (b, m) => void quota.push(`${b}:${m}`), api.fetch);
    await expect(yt.searchRecent('GTA 6', new Date())).rejects.toBeInstanceOf(YouTubeApiError);
    expect(quota).toEqual(['search.list:search.list']);
  });
});

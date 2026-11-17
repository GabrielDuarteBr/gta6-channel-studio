import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHUNK_BYTES, insertBody, YouTubePublisher, youtubeAuthUrl, type FetchLike } from '../src';

let dir: string;
let file: string;
const SIZE = CHUNK_BYTES * 2 + 1000;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'yt-'));
  file = path.join(dir, 'video.mp4');
  await writeFile(file, Buffer.alloc(SIZE, 1));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('YouTube', () => {
  it('consentimento offline com os 3 escopos mínimos', () => {
    const u = new URL(
      youtubeAuthUrl(
        {
          clientId: 'c',
          clientSecret: 's',
          redirectUri: 'http://localhost:3000/api/youtube/callback',
        },
        'xyz',
      ),
    );
    expect(u.searchParams.get('access_type')).toBe('offline');
    expect(u.searchParams.get('state')).toBe('xyz');
    expect(u.searchParams.get('scope')!.split(' ')).toHaveLength(3);
  });

  it('o envio é sempre privado, agendado e marcado como conteúdo sintético', () => {
    const b = insertBody({
      title: 't',
      description: 'd',
      tags: [],
      categoryId: '20',
      publishAt: new Date('2026-11-20T15:00:00Z'),
    });
    expect(b.status).toEqual({
      privacyStatus: 'private',
      publishAt: '2026-11-20T15:00:00.000Z',
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true,
    });
  });

  it('envio resumable em pedaços, com retomada depois de erro do servidor', async () => {
    const ranges: string[] = [];
    let received = 0;
    let failedOnce = false;
    const quota: string[] = [];
    const fetchImpl: FetchLike = async (u, init) => {
      const h = new Headers(init?.headers);
      expect(h.get('authorization')).toBe('Bearer tok');
      if (u.includes('uploadType=resumable')) {
        expect(h.get('x-upload-content-length')).toBe(String(SIZE));
        return new Response(null, {
          status: 200,
          headers: { location: 'https://upload.example/sessao' },
        });
      }
      const cr = h.get('content-range')!;
      ranges.push(cr);
      if (cr.startsWith('bytes */')) {
        return new Response(null, { status: 308, headers: { range: `bytes=0-${received - 1}` } });
      }
      if (!failedOnce && received === CHUNK_BYTES) {
        failedOnce = true;
        return new Response('ops', { status: 503 });
      }
      const [a, b] = /bytes (\d+)-(\d+)\//.exec(cr)!.slice(1).map(Number) as [number, number];
      expect(a).toBe(received);
      received = b + 1;
      if (received >= SIZE) return new Response(JSON.stringify({ id: 'VID123' }), { status: 200 });
      return new Response(null, { status: 308, headers: { range: `bytes=0-${received - 1}` } });
    };
    const yt = new YouTubePublisher(
      async () => 'tok',
      (b, m) => void quota.push(`${b}:${m}`),
      fetchImpl,
    );
    const uri = await yt.startUpload(
      { title: 't', description: 'd', tags: [], categoryId: '20', publishAt: new Date() },
      SIZE,
      'video/mp4',
    );
    expect(uri).toBe('https://upload.example/sessao');
    const progress: number[] = [];
    const id = await yt.uploadFile(uri, file, 0, (p) => void progress.push(p.uploadedBytes));
    expect(id).toBe('VID123');
    expect(ranges.some((r) => r.startsWith('bytes */'))).toBe(true);
    expect(progress.at(-1)).toBe(SIZE);
    expect(quota).toEqual(['videos.insert:videos.insert']);
  });

  it('cota esgotada vira erro claro e definitivo', async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }), {
        status: 403,
      });
    const yt = new YouTubePublisher(async () => 'tok', undefined, fetchImpl);
    await expect(
      yt.startUpload(
        { title: 't', description: 'd', tags: [], categoryId: '20', publishAt: new Date() },
        10,
        'video/mp4',
      ),
    ).rejects.toMatchObject({ retryable: false, reason: 'quotaExceeded' });
  });
});

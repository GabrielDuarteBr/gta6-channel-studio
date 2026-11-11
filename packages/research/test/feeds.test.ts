import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  collectFeedSource,
  discoverFeedLinks,
  extractArticleLinks,
  FeedParseError,
  looksLikeFeed,
  parseFeed,
  publicOnlyFetch,
  type FetchLike,
} from '../src';

const fx = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

describe('parseFeed', () => {
  it('lê RSS 2.0 do WordPress (CDATA, entidades, dc:creator)', () => {
    const items = parseFeed(fx('wordpress-rss.xml'));
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      title: 'GTA 6 Trailer 3 Is Coming Next Week, Rockstar Confirms',
      author: 'Ricky',
    });
    expect(items[0]?.summary).toContain('Grand Theft Auto VI');
    expect(items[0]?.summary).toContain('…'); // entidade dentro do CDATA decodificada
    expect(items[0]?.publishedAt?.toISOString()).toBe('2026-11-09T14:00:00.000Z');
  });

  it('lê Atom (link alternate, published/updated)', () => {
    const items = parseFeed(fx('press-atom.xml'));
    expect(items.map((i) => i.url)).toEqual([
      'https://press.example.com/news/gta-6-trailer-3#comments',
      'https://press.example.com/news/indies',
      'https://press.example.com/news/gta-vi-price',
    ]);
    expect(items[1]?.publishedAt?.toISOString()).toBe('2026-11-09T12:00:00.000Z');
  });

  it('recusa o que não é feed', () => {
    expect(() => parseFeed('<html><body>oi</body></html>')).toThrow(FeedParseError);
    expect(looksLikeFeed(fx('homepage.html'))).toBe(false);
    expect(looksLikeFeed(fx('press-atom.xml'))).toBe(true);
  });
});

describe('páginas', () => {
  it('autodescobre o feed', () => {
    expect(discoverFeedLinks(fx('homepage.html'), 'https://site.com.br/')).toEqual([
      'https://site.com.br/feed/',
    ]);
  });

  it('extrai links de artigos pelo padrão, sem duplicar nem pegar ícones', () => {
    const links = extractArticleLinks(
      fx('newswire.html'),
      'https://www.rockstargames.com/newswire',
      '/newswire/article/',
    );
    expect(links.map((l) => l.title)).toEqual([
      'Grand Theft Auto VI: Watch Trailer 3 Now',
      'GTA Online: Bonuses This Week on Heists',
      'Red Dead Online: New Outlaw Pass',
    ]);
  });
});

describe('collectFeedSource', () => {
  const fakeFetch =
    (
      routes: Record<string, { status?: number; body?: string; headers?: Record<string, string> }>,
    ): FetchLike =>
    async (url) => {
      const r = routes[url];
      if (!r) return new Response('nao achou', { status: 404 });
      const status = r.status ?? 200;
      return new Response(status === 304 ? null : (r.body ?? ''), { status, headers: r.headers });
    };

  it('filtra o que não é GTA 6, limpa a URL e marca rumor e vazamento', async () => {
    const res = await collectFeedSource(
      {
        id: 's1',
        name: 'Intel',
        kind: 'RSS',
        tier: 'COMMUNITY',
        url: 'https://www.rockstarintel.com/feed',
        config: { gtaOnly: true },
      },
      fakeFetch({
        'https://www.rockstarintel.com/feed': {
          body: fx('wordpress-rss.xml'),
          headers: { etag: '"v1"' },
        },
      }),
    );
    expect(res.status).toBe('ok');
    expect(res.fetched).toBe(3);
    expect(res.items.map((i) => i.url)).toEqual([
      'https://www.rockstarintel.com/gta-6-trailer-3-next-week',
      'https://www.rockstarintel.com/gta-6-leaked-footage',
    ]);
    expect(res.items[0]?.domain).toBe('rockstarintel.com');
    expect(res.items[1]?.flags.leak).toBe(true);
    expect(res.items[1]?.isRumor).toBe(true);
    expect(res.etag).toBe('"v1"');
  });

  it('usa GET condicional (304 = sem novidades)', async () => {
    const res = await collectFeedSource(
      { id: 's1', name: 'X', kind: 'RSS', tier: 'PRESS', url: 'https://x.com/feed', etag: '"v1"' },
      fakeFetch({ 'https://x.com/feed': { status: 304 } }),
    );
    expect(res).toMatchObject({ status: 'sem novidades', items: [] });
  });

  it('página HTML: descobre e guarda o feed', async () => {
    const res = await collectFeedSource(
      { id: 's2', name: 'BR', kind: 'RSS', tier: 'PRESS', url: 'https://site.com.br/' },
      fakeFetch({
        'https://site.com.br/': { body: fx('homepage.html') },
        'https://site.com.br/feed/': { body: fx('press-atom.xml') },
      }),
    );
    expect(res.status).toBe('ok');
    expect(res.resolved).toEqual({ feedUrl: 'https://site.com.br/feed/' });
    expect(res.items).toHaveLength(2); // trailer + preço; indie fica de fora
  });

  it('página oficial sem feed: extrai links de artigo e mantém só GTA 6', async () => {
    const res = await collectFeedSource(
      {
        id: 's3',
        name: 'Newswire',
        kind: 'PAGE',
        tier: 'OFFICIAL',
        url: 'https://www.rockstargames.com/newswire',
        config: { linkPattern: '/newswire/article/', gtaOnly: true },
      },
      fakeFetch({ 'https://www.rockstargames.com/newswire': { body: fx('newswire.html') } }),
    );
    expect(res.items.map((i) => i.title)).toEqual(['Grand Theft Auto VI: Watch Trailer 3 Now']);
    expect(res.items[0]?.isRumor).toBe(false); // fonte oficial nunca é rumor
  });

  it('erro de rede vira status "erro" com mensagem, sem derrubar a coleta', async () => {
    const res = await collectFeedSource(
      { id: 's4', name: 'Fora', kind: 'RSS', tier: 'PRESS', url: 'https://fora.com/feed' },
      fakeFetch({}),
    );
    expect(res.status).toBe('erro');
    expect(res.error).toContain('404');
  });
});

describe('publicOnlyFetch (coleta real só em endereços públicos)', () => {
  const ok = (url: string) => new Response('ok', { status: 200, headers: { 'x-url': url } });

  it('busca endereço público e segue redirecionamento público', async () => {
    const calls: string[] = [];
    const base: FetchLike = async (u) => {
      calls.push(u);
      if (u === 'https://site.com/feed')
        return new Response(null, { status: 301, headers: { location: '/feed/' } });
      return ok(u);
    };
    const res = await publicOnlyFetch(base)('https://site.com/feed');
    expect(res.status).toBe(200);
    expect(calls).toEqual(['https://site.com/feed', 'https://site.com/feed/']);
  });

  it('recusa endereço interno antes de abrir conexão', async () => {
    let called = false;
    const base: FetchLike = async (u) => {
      called = true;
      return ok(u);
    };
    await expect(publicOnlyFetch(base)('https://169.254.169.254/latest')).rejects.toThrow(
      /bloqueado/,
    );
    await expect(publicOnlyFetch(base)('https://postgres:5432/')).rejects.toThrow(/bloqueado/);
    expect(called).toBe(false);
  });

  it('recusa redirecionamento para a rede interna', async () => {
    const base: FetchLike = async (u) =>
      u.startsWith('https://site.com')
        ? new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/admin' } })
        : ok(u);
    await expect(publicOnlyFetch(base)('https://site.com/feed')).rejects.toThrow(/127\.0\.0\.1/);
  });

  it('não trata 304 como redirecionamento', async () => {
    const base: FetchLike = async () => new Response(null, { status: 304 });
    expect((await publicOnlyFetch(base)('https://site.com/feed')).status).toBe(304);
  });
});

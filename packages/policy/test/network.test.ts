import { describe, expect, it } from 'vitest';
import { isInternalHost, isPublicHttpsUrl } from '../src';

describe('isPublicHttpsUrl (coletor nunca lê a rede interna)', () => {
  it.each([
    'https://www.ign.com/rss/v2/articles/feed',
    'https://br.ign.com/',
    'https://www.rockstargames.com/newswire',
    'https://8.8.8.8/feed',
  ])('aceita %s', (u) => expect(isPublicHttpsUrl(u)).toBe(true));

  it.each([
    'http://www.ign.com/feed', // sem https
    'https://user:senha@site.com/feed', // credenciais embutidas
    'https://localhost/feed',
    'https://127.0.0.1/feed',
    'https://2130706433/feed', // 127.0.0.1 em decimal
    'https://169.254.169.254/latest/meta-data/', // metadados da nuvem
    'https://10.0.0.5/feed',
    'https://172.20.1.1/feed',
    'https://192.168.0.10/feed',
    'https://[::1]/feed',
    'https://[::ffff:127.0.0.1]/feed',
    'https://[fd00::1]/feed',
    'https://postgres:5432/', // serviço do Docker
    'https://agents/health',
    'https://nas.local/feed',
    'https://api.internal/feed',
    'não é url',
  ])('recusa %s', (u) => expect(isPublicHttpsUrl(u)).toBe(false));

  it('não confunde domínio público que começa com "fd" ou "fc"', () => {
    expect(isInternalHost('fdb.example.com')).toBe(false);
    expect(isInternalHost('fcbarcelona.com')).toBe(false);
  });
});

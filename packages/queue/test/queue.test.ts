import { describe, expect, it } from 'vitest';
import { deterministicJobId, redisConnection } from '../src';

describe('deterministicJobId', () => {
  it('é estável e não contém ":"', () => {
    const a = deterministicJobId('research', 'fetch', '2026-11-09T10:00');
    expect(a).toBe(deterministicJobId('research', 'fetch', '2026-11-09T10:00'));
    expect(a).not.toContain(':');
  });

  it('ids longos viram prefixo + hash, sem colisão entre entradas diferentes', () => {
    const long1 = deterministicJobId('x'.repeat(300), 'a');
    const long2 = deterministicJobId('x'.repeat(300), 'b');
    expect(long1.length).toBeLessThanOrEqual(120);
    expect(long1).not.toBe(long2);
  });
});

describe('redisConnection', () => {
  it('lê host, porta, senha e db da URL', () => {
    expect(redisConnection('redis://:s%40nha@redis:6380/2')).toMatchObject({
      host: 'redis',
      port: 6380,
      password: 's@nha',
      db: 2,
      maxRetriesPerRequest: null,
    });
  });
});

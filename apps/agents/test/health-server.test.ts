import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { startHealthServer } from '../src/health-server';

let close: (() => void) | undefined;
afterEach(() => close?.());

async function start(check: () => Promise<Record<string, unknown>>) {
  const server = startHealthServer(0, check);
  close = () => server.close();
  await once(server, 'listening');
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('health server', () => {
  it('responde 200 quando ok e 404 em outras rotas', async () => {
    const base = await start(async () => ({ status: 'ok' }));
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/outra`)).status).toBe(404);
  });

  it('responde 503 quando a checagem falha', async () => {
    const base = await start(async () => {
      throw new Error('banco fora');
    });
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'down' });
  });
});

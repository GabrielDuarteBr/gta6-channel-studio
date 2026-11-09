import { getPrisma } from '@studio/db';
import { parseEnv, redisEnvSchema, serviceUrlsEnvSchema } from '@studio/shared';
import { Redis } from 'ioredis';

export type CheckStatus = 'ok' | 'down';
export interface CheckResult {
  name: string;
  label: string;
  status: CheckStatus;
  latencyMs: number;
  detail?: string;
}

async function timed(
  name: string,
  label: string,
  fn: () => Promise<string | void>,
): Promise<CheckResult> {
  const start = performance.now();
  try {
    const detail = await fn();
    return {
      name,
      label,
      status: 'ok',
      latencyMs: Math.round(performance.now() - start),
      ...(detail ? { detail } : {}),
    };
  } catch (err) {
    return {
      name,
      label,
      status: 'down',
      latencyMs: Math.round(performance.now() - start),
      detail: err instanceof Error ? err.message.slice(0, 160) : 'erro',
    };
  }
}

async function httpHealth(url: string): Promise<string | void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(2_500), cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json().catch(() => null)) as {
    version?: string;
    profile?: string;
  } | null;
  return body?.profile ? `perfil ${body.profile}` : undefined;
}

export async function checkDatabase(): Promise<CheckResult> {
  return timed('postgres', 'Banco (Postgres)', async () => {
    await getPrisma().$queryRaw`SELECT 1`;
  });
}

export async function checkRedis(): Promise<CheckResult> {
  return timed('redis', 'Filas (Redis)', async () => {
    const { REDIS_URL } = parseEnv(redisEnvSchema);
    const client = new Redis(REDIS_URL, {
      lazyConnect: true,
      connectTimeout: 2_000,
      maxRetriesPerRequest: 0,
    });
    try {
      await client.connect();
      const pong = await client.ping();
      if (pong !== 'PONG') throw new Error(`resposta inesperada: ${pong}`);
    } finally {
      client.disconnect();
    }
  });
}

/** Checagem completa (tela Saúde). */
export async function checkAll(): Promise<CheckResult[]> {
  const urls = parseEnv(serviceUrlsEnvSchema);
  const checks: Array<Promise<CheckResult>> = [
    checkDatabase(),
    checkRedis(),
    timed('agents', 'Agentes', () => httpHealth(`${urls.AGENTS_URL}/health`)),
    timed('render', 'Render (Remotion)', () => httpHealth(`${urls.RENDER_URL}/health`)),
    timed('worker-media', 'Mídia (FFmpeg/Python)', () => httpHealth(`${urls.MEDIA_URL}/health`)),
  ];
  if (urls.S3_HEALTH_URL) {
    const s3 = urls.S3_HEALTH_URL;
    checks.push(
      timed('s3', 'Armazenamento (S3)', async () => {
        const res = await fetch(s3, { signal: AbortSignal.timeout(2_500), cache: 'no-store' });
        if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      }),
    );
  }
  return Promise.all(checks);
}

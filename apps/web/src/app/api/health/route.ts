import { NextResponse } from 'next/server';
import { checkDatabase, checkRedis } from '@/server/health';

export const dynamic = 'force-dynamic';

/** Endpoint público para healthcheck e monitor de disponibilidade. Não expõe detalhes. */
export async function GET() {
  const [db, redis] = await Promise.all([checkDatabase(), checkRedis()]);
  const ok = db.status === 'ok' && redis.status === 'ok';
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', checks: { postgres: db.status, redis: redis.status } },
    { status: ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

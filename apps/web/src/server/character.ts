import { createHash } from 'node:crypto';
import { getPrisma } from '@studio/db';
import { createQueue, deterministicJobId, redisConnection } from '@studio/queue';
import { channelMonth, parseEnv, redisEnvSchema } from '@studio/shared';

/** Mesmo nome e mesma regra de id do job no agents (apps/agents/src/character). */
export const CLIP_JOB = 'character.clip';

export interface ClipRequest {
  script: string;
  layout: 'landscape' | 'vertical';
  /** Voz pedida pelo dono neste clipe (vale mesmo com o modo simulado ligado). */
  tts?: 'fake' | 'google';
}

/** Caracteres de voz do Google gastos no mês (mesma regra do agents). */
export async function googleCharsThisMonth(): Promise<number> {
  const agg = await getPrisma().costLedger.aggregate({
    _sum: { characters: true },
    where: {
      provider: 'tts',
      model: { startsWith: 'google:' },
      dayKey: { startsWith: channelMonth() },
    },
  });
  return agg._sum.characters ?? 0;
}

export function clipJobIdFor(data: ClipRequest, now = new Date()): string {
  const digest = createHash('sha256').update(JSON.stringify(data)).digest('hex').slice(0, 16);
  return deterministicJobId('render', CLIP_JOB, digest, now.toISOString().slice(0, 16));
}

/** Enfileira um clipe de teste (cliques repetidos no mesmo minuto não duplicam). */
export async function enqueueClip(data: ClipRequest): Promise<string> {
  const { REDIS_URL } = parseEnv(redisEnvSchema);
  const queue = createQueue('render', redisConnection(REDIS_URL));
  try {
    const jobId = clipJobIdFor(data);
    await queue.add(CLIP_JOB, data, { jobId, attempts: 2 });
    return jobId;
  } finally {
    await queue.close();
  }
}

export interface ClipRow {
  id: string;
  status: string;
  createdAt: Date;
  finishedAt: Date | null;
  error: string | null;
  layout: string | null;
  script: string | null;
  result: {
    video?: string;
    durationSec?: number;
    expressions?: string[];
    gestures?: string[];
    mouthShapes?: string[];
    ttsProvider?: string;
    render?: { seconds?: number; width?: number; height?: number };
  } | null;
}

export async function listClips(take = 8): Promise<ClipRow[]> {
  const rows = await getPrisma().jobRun.findMany({
    where: { queue: 'render', name: CLIP_JOB },
    orderBy: { createdAt: 'desc' },
    take,
  });
  return rows.map((r) => {
    const payload = (r.payload ?? {}) as { layout?: string; script?: string };
    return {
      id: r.id,
      status: r.status,
      createdAt: r.createdAt,
      finishedAt: r.finishedAt,
      error: r.error,
      layout: payload.layout ?? null,
      script: payload.script ?? null,
      result: (r.result as ClipRow['result']) ?? null,
    };
  });
}

import {
  markYouTubeToken,
  readYouTubeToken,
  saveYouTubeToken,
  type PrismaClient,
} from '@studio/db';
import {
  refreshAccessToken,
  YouTubeError,
  YouTubePublisher,
  type FetchLike,
} from '@studio/providers';
import { loadEncryptionKey } from '@studio/shared';
import { youtubeQuotaDay } from '@studio/shared';

/** Acesso ao canal conectado: renova o access token quando vence (refresh token cifrado no banco). */
export interface YouTubeEnv {
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  encryptionKey: string;
  fetchImpl?: FetchLike;
}

export class NotConnectedError extends Error {
  override name = 'NotConnectedError';
}

export async function youtubePublisher(
  prisma: PrismaClient,
  env: YouTubeEnv,
): Promise<YouTubePublisher> {
  if (!env.clientId || !env.clientSecret) {
    throw new NotConnectedError(
      'Faltam GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET no .env.',
    );
  }
  const key = loadEncryptionKey(env.encryptionKey);
  const first = await readYouTubeToken(prisma, key);
  if (!first)
    throw new NotConnectedError('O YouTube não está conectado (Configurações → YouTube).');
  let cached: { token: string; until: number } | null =
    first.accessToken && first.expiresAt && first.expiresAt.getTime() > Date.now() + 120_000
      ? { token: first.accessToken, until: first.expiresAt.getTime() }
      : null;
  const accessToken = async () => {
    if (cached && cached.until > Date.now() + 60_000) return cached.token;
    const cur = await readYouTubeToken(prisma, key);
    if (!cur) throw new NotConnectedError('O YouTube foi desconectado.');
    try {
      const t = await refreshAccessToken(
        { clientId: env.clientId!, clientSecret: env.clientSecret! },
        cur.refreshToken,
        env.fetchImpl,
      );
      await saveYouTubeToken(prisma, key, {
        ...t,
        refreshToken: t.refreshToken ?? cur.refreshToken,
      });
      cached = { token: t.accessToken, until: t.expiresAt.getTime() };
      return t.accessToken;
    } catch (err) {
      if (err instanceof YouTubeError && err.reason === 'invalid_grant') {
        await markYouTubeToken(prisma, 'invalid', err.message);
      }
      throw err;
    }
  };
  // Cota por balde (videos.insert tem balde próprio), no dia do Pacífico.
  const record = async (bucket: string, method: string, units: number) => {
    await prisma.quotaLedger.create({
      data: { pacificDay: youtubeQuotaDay(), bucket, method, units, simulated: false },
    });
  };
  return new YouTubePublisher(accessToken, record, env.fetchImpl);
}

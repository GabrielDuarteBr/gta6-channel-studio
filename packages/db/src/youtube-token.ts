import { decryptSecret, encryptSecret } from '@studio/shared';
import type { PrismaClient } from './generated/prisma/client';

/**
 * Conexão com o YouTube (Fase 5): o refresh token e o access token ficam CIFRADOS
 * (AES-256-GCM, contexto amarrado ao uso) na tabela OAuthToken. Só um canal conectado por vez.
 */
export const YOUTUBE_PROVIDER = 'youtube';
const ACCOUNT = 'canal';
const ctx = (kind: 'refresh' | 'access') => `oauth:${YOUTUBE_PROVIDER}:${kind}`;

export interface YouTubeConnection {
  channelId: string | null;
  channelTitle: string | null;
  status: string;
  scopes: string[];
  lastError: string | null;
  updatedAt: Date;
}

/** Situação da conexão (sem decifrar nada). */
export async function youtubeConnection(prisma: PrismaClient): Promise<YouTubeConnection | null> {
  const row = await prisma.oAuthToken.findUnique({
    where: { provider_accountLabel: { provider: YOUTUBE_PROVIDER, accountLabel: ACCOUNT } },
  });
  if (!row) return null;
  const meta = (row.scopes.find((s) => s.startsWith('canal:')) ?? '').slice(6);
  const [id, ...name] = meta.split('|');
  return {
    channelId: id || null,
    channelTitle: name.join('|') || null,
    status: row.status,
    scopes: row.scopes.filter((s) => !s.startsWith('canal:')),
    lastError: row.lastError,
    updatedAt: row.updatedAt,
  };
}

export async function saveYouTubeToken(
  prisma: PrismaClient,
  key: Buffer,
  t: {
    accessToken: string;
    refreshToken?: string | undefined;
    expiresAt: Date;
    scopes: string[];
    channel?: { id: string; title: string } | undefined;
  },
): Promise<void> {
  const where = { provider_accountLabel: { provider: YOUTUBE_PROVIDER, accountLabel: ACCOUNT } };
  const existing = await prisma.oAuthToken.findUnique({ where });
  const refresh = t.refreshToken ?? (existing ? null : undefined);
  if (refresh === undefined) throw new Error('o Google não devolveu o refresh token (conecte de novo)');
  const channelScope = t.channel
    ? `canal:${t.channel.id}|${t.channel.title}`
    : existing?.scopes.find((s) => s.startsWith('canal:'));
  const scopes = [...t.scopes.filter((s) => !s.startsWith('canal:')), ...(channelScope ? [channelScope] : [])];
  const data = {
    scopes,
    accessTokenEnc: encryptSecret(t.accessToken, key, ctx('access')),
    expiresAt: t.expiresAt,
    status: 'ok',
    lastError: null,
    lastCheckedAt: new Date(),
    ...(refresh ? { refreshTokenEnc: encryptSecret(refresh, key, ctx('refresh')) } : {}),
  };
  if (existing) await prisma.oAuthToken.update({ where, data });
  else {
    await prisma.oAuthToken.create({
      data: {
        provider: YOUTUBE_PROVIDER,
        accountLabel: ACCOUNT,
        refreshTokenEnc: data.refreshTokenEnc!,
        ...data,
      },
    });
  }
}

export interface DecryptedToken {
  accessToken: string | null;
  refreshToken: string;
  expiresAt: Date | null;
}

export async function readYouTubeToken(prisma: PrismaClient, key: Buffer): Promise<DecryptedToken | null> {
  const row = await prisma.oAuthToken.findUnique({
    where: { provider_accountLabel: { provider: YOUTUBE_PROVIDER, accountLabel: ACCOUNT } },
  });
  if (!row || row.status === 'revoked') return null;
  return {
    accessToken: row.accessTokenEnc ? decryptSecret(row.accessTokenEnc, key, ctx('access')) : null,
    refreshToken: decryptSecret(row.refreshTokenEnc, key, ctx('refresh')),
    expiresAt: row.expiresAt,
  };
}

export async function markYouTubeToken(prisma: PrismaClient, status: 'invalid' | 'revoked', error: string) {
  await prisma.oAuthToken.updateMany({
    where: { provider: YOUTUBE_PROVIDER, accountLabel: ACCOUNT },
    data: { status, lastError: error.slice(0, 300), lastCheckedAt: new Date() },
  });
}

export async function deleteYouTubeToken(prisma: PrismaClient): Promise<void> {
  await prisma.oAuthToken.deleteMany({ where: { provider: YOUTUBE_PROVIDER, accountLabel: ACCOUNT } });
}

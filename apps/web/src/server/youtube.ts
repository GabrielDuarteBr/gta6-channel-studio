import {
  audit,
  deleteYouTubeToken,
  getPrisma,
  readYouTubeToken,
  saveYouTubeToken,
} from '@studio/db';
import { exchangeCode, revokeToken, YouTubePublisher, type OAuthClient } from '@studio/providers';
import { encryptionEnvSchema, loadEncryptionKey, parseEnv } from '@studio/shared';

/**
 * Conexão do canal (OAuth 2.0 de servidor web). O dono entra com a conta do canal na tela do
 * Google; nunca pedimos a senha. Refresh token cifrado no banco (AES-256-GCM).
 */

export const OAUTH_STATE_COOKIE = 'yt_oauth_state';

export function oauthClient(): OAuthClient | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const base = (process.env.AUTH_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return { clientId, clientSecret, redirectUri: `${base}/api/youtube/callback` };
}

function key() {
  return loadEncryptionKey(parseEnv(encryptionEnvSchema).TOKEN_ENCRYPTION_KEY);
}

/** Troca o código pelo token, lê o canal e guarda tudo cifrado. */
export async function finishConnection(code: string): Promise<{ title: string }> {
  const client = oauthClient();
  if (!client)
    throw new Error('Faltam GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET no .env.');
  const prisma = getPrisma();
  const tokens = await exchangeCode(client, code);
  if (!tokens.refreshToken) {
    throw new Error(
      'O Google não devolveu o refresh token. Remova o acesso do app em myaccount.google.com/permissions e conecte de novo.',
    );
  }
  const missing = [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
  ].filter((s) => !tokens.scopes.includes(s));
  if (missing.length) {
    throw new Error(
      'Marque todas as permissões na tela do Google (envio de vídeos e estatísticas).',
    );
  }
  const yt = new YouTubePublisher(
    async () => tokens.accessToken,
    () => undefined,
  );
  const channel = await yt.myChannel();
  await saveYouTubeToken(prisma, key(), {
    ...tokens,
    channel: { id: channel.id, title: channel.title },
  });
  await audit(prisma, {
    actor: 'owner',
    action: 'youtube.connect',
    target: channel.id,
    details: { title: channel.title, scopes: tokens.scopes },
  });
  return { title: channel.title };
}

export async function disconnectYouTube(): Promise<void> {
  const prisma = getPrisma();
  const token = await readYouTubeToken(prisma, key()).catch(() => null);
  if (token?.refreshToken) await revokeToken(token.refreshToken);
  await deleteYouTubeToken(prisma);
  await audit(prisma, { actor: 'owner', action: 'youtube.disconnect' });
}

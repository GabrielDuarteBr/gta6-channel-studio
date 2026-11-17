import { randomBytes } from 'node:crypto';
import { youtubeAuthUrl } from '@studio/providers';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { appUrl, OAUTH_STATE_COOKIE, oauthClient } from '@/server/youtube';

/** Início do OAuth: só o dono logado; "state" aleatório num cookie contra CSRF. */
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(appUrl('/login'));
  const client = oauthClient();
  if (!client) {
    return NextResponse.redirect(appUrl('/configuracoes?youtube=sem-chaves#youtube'));
  }
  const state = randomBytes(24).toString('base64url');
  const res = NextResponse.redirect(youtubeAuthUrl(client, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: appUrl('/').protocol === 'https:',
    path: '/api/youtube',
    maxAge: 600,
  });
  return res;
}

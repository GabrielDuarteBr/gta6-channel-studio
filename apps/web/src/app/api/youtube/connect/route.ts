import { randomBytes } from 'node:crypto';
import { youtubeAuthUrl } from '@studio/providers';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { OAUTH_STATE_COOKIE, oauthClient } from '@/server/youtube';

/** Início do OAuth: só o dono logado; "state" aleatório num cookie contra CSRF. */
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL('/login', req.url));
  const client = oauthClient();
  if (!client) {
    return NextResponse.redirect(new URL('/configuracoes?youtube=sem-chaves#youtube', req.url));
  }
  const state = randomBytes(24).toString('base64url');
  const res = NextResponse.redirect(youtubeAuthUrl(client, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(req.url).protocol === 'https:',
    path: '/api/youtube',
    maxAge: 600,
  });
  return res;
}

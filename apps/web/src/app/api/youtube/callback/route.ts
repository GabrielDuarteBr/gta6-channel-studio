import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { auth } from '@/auth';
import { finishConnection, OAUTH_STATE_COOKIE } from '@/server/youtube';

/** Volta do Google: confere o "state", troca o código e guarda o token cifrado. */
export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL('/login', req.url));
  const back = (status: string, msg?: string) => {
    const u = new URL('/configuracoes', req.url);
    u.searchParams.set('youtube', status);
    if (msg) u.searchParams.set('msg', msg.slice(0, 200));
    u.hash = 'youtube';
    const res = NextResponse.redirect(u);
    res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: '/api/youtube' });
    return res;
  };
  const q = req.nextUrl.searchParams;
  if (q.get('error'))
    return back(
      'erro',
      q.get('error') === 'access_denied' ? 'Você cancelou no Google.' : q.get('error')!,
    );
  const state = q.get('state') ?? '';
  const expected = req.cookies.get(OAUTH_STATE_COOKIE)?.value ?? '';
  const sameState =
    state.length > 0 &&
    state.length === expected.length &&
    timingSafeEqual(Buffer.from(state), Buffer.from(expected));
  if (!sameState) return back('erro', 'Sessão do Google expirou. Tente conectar de novo.');
  const code = q.get('code');
  if (!code) return back('erro', 'O Google não devolveu o código.');
  try {
    const { title } = await finishConnection(code);
    return back('ok', title);
  } catch (err) {
    return back('erro', (err as Error).message);
  }
}

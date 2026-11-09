// Barreira de autenticação na borda: tudo exige login, exceto login, auth e health.
// As páginas e server actions verificam a sessão de novo (requireOwner).
export { auth as proxy } from '@/auth';

export const config = {
  matcher: ['/((?!api/auth|api/health|login|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};

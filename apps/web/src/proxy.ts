// Barreira de autenticação na borda: tudo exige login, exceto login, auth e health.
// As páginas e server actions verificam a sessão de novo (requireOwner).
// O envio de vídeo de parceiro fica fora (o proxy guardaria o corpo na memória e cortaria em
// 25 MB); a própria rota confere a sessão do dono.
export { auth as proxy } from '@/auth';

export const config = {
  matcher: [
    '/((?!api/auth|api/health|api/partners/upload|login|_next/static|_next/image|favicon.ico|icon.svg).*)',
  ],
};

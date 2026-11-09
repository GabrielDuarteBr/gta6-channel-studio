import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { ZecaPlaceholder } from '@/components/zeca-placeholder';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ expirada?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect('/');
  const { expirada } = await searchParams;

  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <ZecaPlaceholder className="size-28" />
          <h1 className="font-display neon-text mt-3 text-4xl">Radar Neon</h1>
          <p className="text-sm text-haze-400">Estúdio do canal · acesso só do dono</p>
          <div className="sunset-line mt-4 h-0.5 w-24 rounded-full" />
        </div>
        <div className="rounded-2xl border border-night-700 bg-night-900/90 p-6 shadow-[0_0_60px_rgb(255_61_139/0.08)]">
          {expirada ? (
            <p className="mb-4 rounded-lg border border-sunset/40 bg-sunset/10 px-3 py-2 text-sm text-sunset">
              Sua sessão expirou. Entre de novo.
            </p>
          ) : null}
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-haze-500">
          Login com senha + 2FA (TOTP). Cinco erros seguidos bloqueiam por 15 minutos.
        </p>
      </div>
    </main>
  );
}

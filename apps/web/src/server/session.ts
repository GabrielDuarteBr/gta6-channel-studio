import { getPrisma } from '@studio/db';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';

/**
 * Garante que quem acessa é o dono. Confere também se o usuário da sessão
 * ainda existe (recriar o dono invalida sessões antigas).
 */
export async function requireOwner(): Promise<{ id: string; email: string }> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) redirect('/login');
  const user = await getPrisma().user.findUnique({
    where: { id },
    select: { id: true, email: true, sessionVersion: true },
  });
  const sessionVersion = (session as { sessionVersion?: number }).sessionVersion;
  if (!user || user.sessionVersion !== sessionVersion) redirect('/login?expirada=1');
  return { id: user.id, email: user.email };
}

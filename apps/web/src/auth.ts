import { getPrisma, verifyOwnerLogin } from '@studio/db';
import { authEnvSchema, loadEncryptionKey, parseEnv } from '@studio/shared';
import NextAuth, { CredentialsSignin } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';

class InvalidLogin extends CredentialsSignin {
  override code = 'invalid';
}
class LockedLogin extends CredentialsSignin {
  override code = 'locked';
}

const loginSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
  code: z.string().trim().min(6).max(12),
});

function clientIp(headers: Headers): string | undefined {
  return (
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || undefined
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: 12 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {}, code: {} },
      async authorize(raw, request) {
        const parsed = loginSchema.safeParse(raw);
        if (!parsed.success) throw new InvalidLogin();
        const key = loadEncryptionKey(parseEnv(authEnvSchema).TOKEN_ENCRYPTION_KEY);
        const ip = clientIp(request.headers);
        const result = await verifyOwnerLogin(getPrisma(), key, {
          ...parsed.data,
          ...(ip ? { ip } : {}),
        });
        if (!result.ok) throw result.reason === 'locked' ? new LockedLogin() : new InvalidLogin();
        return {
          id: result.user.id,
          email: result.user.email,
          name: 'Dono do canal',
          sessionVersion: result.user.sessionVersion,
        };
      },
    }),
  ],
  callbacks: {
    authorized: ({ auth: session }) => Boolean(session?.user),
    jwt({ token, user }) {
      if (user?.id) {
        token.uid = user.id;
        token.sv = (user as { sessionVersion?: number }).sessionVersion ?? 0;
      }
      return token;
    },
    session({ session, token }) {
      if (typeof token.uid === 'string') session.user.id = token.uid;
      (session as { sessionVersion?: number }).sessionVersion =
        typeof token.sv === 'number' ? token.sv : -1;
      return session;
    },
  },
});

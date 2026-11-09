'use server';

import { AuthError } from 'next-auth';
import { signIn } from '@/auth';

export interface LoginState {
  error?: string;
}

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  try {
    await signIn('credentials', {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      code: String(form.get('code') ?? ''),
      redirectTo: '/',
    });
    return {};
  } catch (err) {
    if (err instanceof AuthError) {
      const code = (err as AuthError & { code?: string }).code;
      return {
        error:
          code === 'locked'
            ? 'Muitas tentativas erradas. O login fica bloqueado por 15 minutos.'
            : 'E-mail, senha ou código inválidos.',
      };
    }
    throw err; // redirecionamento de sucesso do Next
  }
}

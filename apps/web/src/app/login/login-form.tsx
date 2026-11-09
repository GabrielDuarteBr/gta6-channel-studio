'use client';

import { KeyRound, LogIn } from 'lucide-react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { loginAction, type LoginState } from './actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Senha</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="code">Código do app autenticador</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="123456 ou código de recuperação"
          required
        />
      </div>
      {state.error ? (
        <p
          role="alert"
          className="rounded-lg border border-alert/40 bg-alert/10 px-3 py-2 text-sm text-alert"
        >
          {state.error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <KeyRound className="animate-pulse" /> : <LogIn />}
        {pending ? 'Verificando…' : 'Entrar'}
      </Button>
    </form>
  );
}

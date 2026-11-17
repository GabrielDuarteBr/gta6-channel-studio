'use client';

import { useActionState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface ActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

/**
 * Formulário de server action com retorno de mensagem (ok/erro) logo abaixo dos campos.
 * `children` recebe `pending` para desabilitar o botão enquanto envia.
 */
export function ActionForm({
  action,
  children,
  className,
  testId,
  resetOnOk,
}: {
  action: (prev: ActionState, form: FormData) => Promise<ActionState>;
  children: (pending: boolean) => ReactNode;
  className?: string;
  testId?: string;
  resetOnOk?: boolean;
}) {
  const [state, run, pending] = useActionState<ActionState, FormData>(action, {});
  return (
    <form
      action={run}
      className={cn('space-y-2', className)}
      data-testid={testId}
      key={resetOnOk && state.ok ? String(state.message) : undefined}
    >
      {children(pending)}
      {state.message && !pending ? (
        <p role="status" className="text-xs text-palm">
          {state.message}
        </p>
      ) : null}
      {state.error && !pending ? (
        <p role="alert" className="text-xs text-alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

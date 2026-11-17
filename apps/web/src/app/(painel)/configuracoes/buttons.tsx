'use client';

import { Play, RefreshCw } from 'lucide-react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { runDailyNowAction, syncMetricsNowAction, type SaveState } from './actions';

/** "Rodar agora" da produção diária (respeita limites e teto; tudo vai para a Aprovação). */
export function RunDailyButton() {
  const [state, run, pending] = useActionState<SaveState, FormData>(runDailyNowAction, {});
  return (
    <form action={run} className="flex items-center gap-2">
      <Button
        type="submit"
        size="sm"
        variant="secondary"
        disabled={pending}
        data-testid="rodar-diaria"
      >
        <Play /> {pending ? 'Enviando…' : 'Rodar agora'}
      </Button>
      {state.ok ? (
        <span role="status" className="text-xs text-palm">
          Na fila. Veja em Produção.
        </span>
      ) : null}
    </form>
  );
}

export function SyncMetricsButton() {
  const [state, run, pending] = useActionState<SaveState, FormData>(syncMetricsNowAction, {});
  return (
    <form action={run} className="flex items-center gap-2">
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        <RefreshCw /> Sincronizar métricas
      </Button>
      {state.ok ? (
        <span role="status" className="text-xs text-palm">
          Pedido enviado.
        </span>
      ) : null}
    </form>
  );
}

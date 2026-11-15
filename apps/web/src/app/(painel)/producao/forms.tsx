'use client';

import { Clapperboard } from 'lucide-react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { startProductionAction, type ProductionActionState } from './actions';

export function ProduceForm({ storyId }: { storyId: string }) {
  const [state, action, pending] = useActionState<ProductionActionState, FormData>(
    startProductionAction,
    {},
  );
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="storyId" value={storyId} />
      <Button type="submit" size="sm" disabled={pending || state.ok}>
        <Clapperboard /> {pending ? 'Enviando…' : 'Produzir'}
      </Button>
      {state.message ? (
        <p role="status" className="text-xs text-palm">
          {state.message}
        </p>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-xs text-alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

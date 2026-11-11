'use client';

import { Ban, Clapperboard, Film, Layers, RefreshCw, RotateCcw } from 'lucide-react';
import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { collectNowAction, setStoryStatusAction, type ActionState } from './actions';

export function CollectNowButton() {
  const [state, action, pending] = useActionState<ActionState>(collectNowAction, {});
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="secondary" disabled={pending} data-testid="coletar-agora">
        <RefreshCw className={pending ? 'animate-spin' : undefined} /> Coletar agora
      </Button>
      {state.message ? (
        <span role="status" className="text-xs text-palm">
          {state.message}
        </span>
      ) : null}
      {state.error ? (
        <span role="alert" className="text-xs text-alert">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

const PROMOTE = [
  { status: 'QUEUED_LONG', label: 'Virar longo', icon: Film },
  { status: 'QUEUED_SHORT', label: 'Virar Short', icon: Clapperboard },
  { status: 'QUEUED_COMPILATION', label: 'Entrar no compilado', icon: Layers },
] as const;

export function StoryActions({
  storyId,
  status,
  blockedReasons,
}: {
  storyId: string;
  status: string;
  blockedReasons: string[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(setStoryStatusAction, {});
  const blocked = blockedReasons.length > 0;
  return (
    <form action={action} className="space-y-2" data-testid={`acoes-${storyId}`}>
      <input type="hidden" name="storyId" value={storyId} />
      <div className="flex flex-wrap gap-2">
        {status === 'NEW' ? (
          <>
            {PROMOTE.map(({ status: s, label, icon: Icon }) => (
              <Button
                key={s}
                type="submit"
                name="status"
                value={s}
                size="sm"
                variant={s === 'QUEUED_LONG' ? 'primary' : 'secondary'}
                disabled={pending || blocked}
                title={blocked ? blockedReasons.join(' ') : undefined}
              >
                <Icon /> {label}
              </Button>
            ))}
            <Button
              type="submit"
              name="status"
              value="DISMISSED"
              size="sm"
              variant="ghost"
              disabled={pending}
            >
              <Ban /> Descartar
            </Button>
          </>
        ) : (
          <Button
            type="submit"
            name="status"
            value="NEW"
            size="sm"
            variant="ghost"
            disabled={pending}
          >
            <RotateCcw /> Desfazer
          </Button>
        )}
      </div>
      {blocked && status === 'NEW' ? (
        <p className="text-xs text-sunset" data-testid={`bloqueio-${storyId}`}>
          Bloqueado: {blockedReasons.join(' ')}
        </p>
      ) : null}
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

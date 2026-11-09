'use client';

import { Check, Save } from 'lucide-react';
import { useActionState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { saveSettingAction, type SaveState } from './actions';

export function SettingForm({
  settingKey,
  title,
  description,
  children,
}: {
  settingKey: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveSettingAction, {});
  return (
    <Card>
      <form action={action} className="space-y-4" data-testid={`form-${settingKey}`}>
        <input type="hidden" name="key" value={settingKey} />
        <div>
          <CardTitle>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {children}
        <div className="flex items-center gap-3">
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            <Save /> {pending ? 'Salvando…' : 'Salvar'}
          </Button>
          {state.ok && !pending ? (
            <span role="status" className="inline-flex items-center gap-1 text-sm text-palm">
              <Check className="size-4" /> Salvo
            </span>
          ) : null}
          {state.error && !pending ? (
            <span role="alert" className="text-sm text-alert">
              {state.error}
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

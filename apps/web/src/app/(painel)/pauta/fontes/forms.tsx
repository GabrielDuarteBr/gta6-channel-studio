'use client';

import { Plus, Save } from 'lucide-react';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Toggle } from '@/components/ui/input';
import { addSourceAction, updateSourceUrlAction, type SourceActionState } from './actions';

export function AddSourceForm() {
  const [state, action, pending] = useActionState<SourceActionState, FormData>(addSourceAction, {});
  const [kind, setKind] = useState('RSS');
  return (
    <Card>
      <CardTitle>Adicionar fonte</CardTitle>
      <CardDescription>
        Feed RSS/Atom (ou o endereço do site, se ele anunciar o feed), página oficial sem feed (com
        padrão de link) ou canal do YouTube pelo @handle (só metadados, pela API).
      </CardDescription>
      <form
        action={action}
        className="mt-4 grid gap-3 sm:grid-cols-2"
        data-testid="form-nova-fonte"
      >
        <div className="space-y-1.5">
          <Label htmlFor="src-name">Nome</Label>
          <Input id="src-name" name="name" required placeholder="Ex.: Kotaku" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="src-kind">Tipo</Label>
          <Select id="src-kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="RSS">Feed RSS/Atom (ou site com feed)</option>
            <option value="PAGE">Página sem feed</option>
            <option value="YOUTUBE_CHANNEL">Canal do YouTube (@handle)</option>
          </Select>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="src-url">
            {kind === 'YOUTUBE_CHANNEL' ? '@handle do canal' : 'Endereço (https)'}
          </Label>
          <Input
            id="src-url"
            name="url"
            required
            placeholder={kind === 'YOUTUBE_CHANNEL' ? '@RockstarGames' : 'https://site.com/feed'}
          />
        </div>
        {kind === 'PAGE' ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="src-pattern">Padrão do link dos artigos</Label>
            <Input id="src-pattern" name="linkPattern" placeholder="/noticias/" />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="src-tier">Nível</Label>
          <Select id="src-tier" name="tier" defaultValue="PRESS">
            <option value="OFFICIAL">Oficial (Rockstar/Take-Two)</option>
            <option value="PRESS">Imprensa</option>
            <option value="COMMUNITY">Comunidade/fãs</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="src-lang">Idioma</Label>
          <Select id="src-lang" name="language" defaultValue="pt-BR">
            <option value="pt-BR">Português</option>
            <option value="en">Inglês</option>
            <option value="es">Espanhol</option>
          </Select>
        </div>
        <Toggle
          name="gtaOnly"
          className="sm:col-span-2"
          label="Site focado em GTA/Rockstar"
          description="Aceita também notícias que citam só Rockstar/Leonida (sem 'GTA 6' no título)."
        />
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" size="sm" disabled={pending}>
            <Plus /> Adicionar
          </Button>
          {state.message ? (
            <span role="status" className="text-sm text-palm">
              {state.message}
            </span>
          ) : null}
          {state.error ? (
            <span role="alert" className="text-sm text-alert">
              {state.error}
            </span>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

export function EditUrlForm({ id, url }: { id: string; url: string }) {
  const [state, action, pending] = useActionState<SourceActionState, FormData>(
    updateSourceUrlAction,
    {},
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Input name="url" defaultValue={url} className="h-8 text-xs" aria-label="Endereço da fonte" />
      <Button
        type="submit"
        size="sm"
        variant="ghost"
        disabled={pending}
        aria-label="Salvar endereço"
      >
        <Save />
      </Button>
      {state.error ? (
        <span role="alert" className="text-xs text-alert">
          {state.error}
        </span>
      ) : null}
      {state.message ? (
        <span role="status" className="text-xs text-palm">
          ✓
        </span>
      ) : null}
    </form>
  );
}

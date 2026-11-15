'use client';

import type { CharacterBible } from '@studio/avatar';
import { Clapperboard, Save } from 'lucide-react';
import { Fragment, useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { generateClipAction, saveBibleAction, type ActionState } from './actions';

const textarea =
  'w-full rounded-lg border border-night-600 bg-night-900 px-3 py-2 text-sm text-white placeholder:text-haze-500 focus:border-neon-cyan focus:outline-none';

function Feedback({ state }: { state: ActionState }) {
  if (state.message) {
    return (
      <p role="status" className="text-sm text-palm">
        {state.message}
      </p>
    );
  }
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-alert">
        {state.error}
      </p>
    );
  }
  return null;
}

export function ClipForm({
  demoScript,
  allowedTags,
  defaultVoice,
  defaultLayout,
}: {
  demoScript: string;
  allowedTags: string[];
  defaultVoice: 'fake' | 'google';
  defaultLayout: 'landscape' | 'vertical';
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(generateClipAction, {});
  return (
    <form action={action} className="space-y-3" data-testid="form-clipe">
      <div className="space-y-1.5">
        <Label htmlFor="clip-script">O que o Zeca fala</Label>
        <textarea
          id="clip-script"
          name="script"
          rows={5}
          defaultValue={demoScript}
          className={textarea}
          required
        />
        <p className="text-xs text-haze-500">
          Marcações: {allowedTags.map((t) => `[${t}]`).join(' ')}. A expressão vale até a próxima.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48 space-y-1.5">
          <Label htmlFor="clip-layout">Formato</Label>
          <Select id="clip-layout" name="layout" defaultValue={defaultLayout}>
            <option value="landscape">Vídeo longo (16:9)</option>
            <option value="vertical">Short (9:16)</option>
          </Select>
        </div>
        <div className="w-56 space-y-1.5">
          <Label htmlFor="clip-tts">Voz</Label>
          <Select id="clip-tts" name="tts" defaultValue={defaultVoice}>
            <option value="google">Google Chirp 3 HD (real)</option>
            <option value="fake">Voz de teste (robótica, grátis)</option>
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          <Clapperboard /> Gerar clipe de teste
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

export function BibleForm({
  bible,
  version,
  lockedRules,
}: {
  bible: CharacterBible;
  version: number;
  lockedRules: string[];
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(saveBibleAction, {});
  const extraRules = bible.rules.filter((r) => !lockedRules.includes(r));
  const field = (id: string, label: string, value: string, rows = 3, hint?: string) => (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <textarea id={id} name={id} rows={rows} defaultValue={value} className={textarea} />
      {hint ? <p className="text-xs text-haze-500">{hint}</p> : null}
    </div>
  );
  return (
    <form action={action} className="grid gap-4 lg:grid-cols-2" data-testid="form-biblia">
      {/* Campos recriados quando a versão muda (ex.: depois de restaurar), sem perder a mensagem. */}
      <Fragment key={version}>
        <div className="space-y-4">
          {field('summary', 'Resumo', bible.summary, 3)}
          {field('personality', 'Personalidade', bible.personality.join('\n'), 5, 'Uma por linha.')}
          {field('look', 'Visual', bible.look.join('\n'), 3, 'Uma por linha.')}
          {field('aiDisclosure', 'Aviso de IA', bible.aiDisclosure, 2)}
        </div>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="tone">Tom da voz</Label>
              <Input id="tone" name="tone" defaultValue={bible.voice.tone} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pace">Ritmo</Label>
              <Input id="pace" name="pace" defaultValue={bible.voice.pace} />
            </div>
          </div>
          {field(
            'catchphrases',
            'Bordões',
            bible.voice.catchphrases.join('\n'),
            3,
            'Um por linha.',
          )}
          {field('avoid', 'Evitar', bible.voice.avoid.join('\n'), 3, 'Um por linha.')}
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-haze-300">Regras fixas (não saem)</span>
            <ul className="space-y-1 rounded-lg border border-night-700 bg-night-900/60 p-3 text-xs text-haze-400">
              {lockedRules.map((r) => (
                <li key={r}>🔒 {r}</li>
              ))}
            </ul>
          </div>
          {field('rules', 'Outras regras', extraRules.join('\n'), 3, 'Uma por linha.')}
        </div>
      </Fragment>
      <div className="flex flex-wrap items-end gap-3 lg:col-span-2">
        <div className="w-full max-w-sm space-y-1.5">
          <Label htmlFor="note">O que mudou (opcional)</Label>
          <Input id="note" name="note" placeholder="Ex.: bordão novo" />
        </div>
        <Button type="submit" disabled={pending}>
          <Save /> Salvar nova versão
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

'use client';

import type { CharacterBible } from '@studio/avatar';
import { Clapperboard, Save, Upload } from 'lucide-react';
import { Fragment, useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { generateClipAction, saveBibleAction, uploadArtAction, type ActionState } from './actions';

const textarea =
  'w-full rounded-lg border border-night-600 bg-night-900 px-3 py-2 text-sm text-white placeholder:text-haze-500 focus:border-neon-cyan focus:outline-none';

function Feedback({ state }: { state: ActionState }) {
  const details = state.details?.length ? (
    <ul className="mt-1 list-disc pl-5 text-xs text-haze-400" data-testid="detalhes">
      {state.details.map((d) => (
        <li key={d}>{d}</li>
      ))}
    </ul>
  ) : null;
  if (state.message) {
    return (
      <div role="status" className="text-sm text-palm">
        {state.message}
        {details}
      </div>
    );
  }
  if (state.error) {
    return (
      <div role="alert" className="text-sm text-alert">
        {state.error}
        {details}
      </div>
    );
  }
  return null;
}

export function ClipForm({
  demoScript,
  allowedTags,
  defaultVoice,
  defaultLayout,
  artOptions = [],
}: {
  demoScript: string;
  allowedTags: string[];
  defaultVoice: 'fake' | 'google';
  defaultLayout: 'landscape' | 'vertical';
  /** Versões da arte do artista que podem ser testadas (rascunhos). */
  artOptions?: Array<{ version: number; label: string }>;
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
        {artOptions.length ? (
          <div className="w-56 space-y-1.5">
            <Label htmlFor="clip-art">Arte</Label>
            <Select id="clip-art" name="artVersion" defaultValue="">
              <option value="">A que está em uso</option>
              {artOptions.map((o) => (
                <option key={o.version} value={o.version}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
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

/** Envio do pacote de camadas do artista (PNG/SVG) com a prova de direitos. */
export function ArtUploadForm({ pivots }: { pivots: { head: number[]; arm: number[] } }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(uploadArtAction, {});
  return (
    <form action={action} className="space-y-3" data-testid="form-arte">
      <div className="space-y-1.5">
        <Label htmlFor="art-layers">Camadas (PNG ou SVG, todas do mesmo tamanho)</Label>
        <input
          id="art-layers"
          name="layers"
          type="file"
          multiple
          accept=".png,.svg,image/png,image/svg+xml"
          required
          className="block w-full text-sm text-haze-300 file:mr-3 file:rounded-lg file:border-0 file:bg-night-700 file:px-3 file:py-2 file:text-white"
        />
        <p className="text-xs text-haze-500">
          Abra a pasta das camadas, aperte Ctrl+A e escolha todas. Nomes no padrão do guia
          (corpo.png, cabeca.png, boca-A.png...).
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="art-artist">Artista</Label>
          <Input id="art-artist" name="artist" required placeholder="Nome do ilustrador" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="art-proof-file">Contrato (PDF, PNG ou JPG, opcional)</Label>
          <input
            id="art-proof-file"
            name="proof"
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
            className="block w-full text-sm text-haze-300 file:mr-3 file:rounded-lg file:border-0 file:bg-night-700 file:px-3 file:py-2 file:text-white"
          />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="art-rights">Prova de direitos</Label>
        <textarea
          id="art-rights"
          name="rightsProof"
          rows={2}
          required
          className={textarea}
          placeholder="Ex.: contrato de cessão de direitos assinado em 20/11/2026 com Fulano; o canal pode usar e animar o personagem em vídeos, inclusive monetizados."
        />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-haze-300">Ajuste fino: pontos de giro (%)</summary>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              ['headX', 'Pescoço X', pivots.head[0]],
              ['headY', 'Pescoço Y', pivots.head[1]],
              ['armX', 'Ombro X', pivots.arm[0]],
              ['armY', 'Ombro Y', pivots.arm[1]],
            ] as const
          ).map(([name, label, value]) => (
            <div key={name} className="space-y-1">
              <Label htmlFor={`art-${name}`}>{label}</Label>
              <Input
                id={`art-${name}`}
                name={name}
                defaultValue={String(value)}
                inputMode="decimal"
              />
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-haze-500">
          Onde a cabeça gira (pescoço) e onde o braço gira (ombro), em % da largura e da altura da
          tela.
        </p>
      </details>
      <Button type="submit" disabled={pending}>
        <Upload /> {pending ? 'Conferindo…' : 'Enviar arte'}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

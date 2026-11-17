'use client';

import { Clapperboard, Copy, Link2, Search, ShieldCheck, Upload, UserPlus } from 'lucide-react';
import { useActionState, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import {
  addChannelAction,
  huntAction,
  importLinkAction,
  permissionAction,
  permissionStatusAction,
  reactAction,
  type PartnerActionState,
} from './actions';

function Feedback({ state, testId }: { state: PartnerActionState; testId?: string }) {
  if (state.message) {
    return (
      <div role="status" className="text-sm text-palm" data-testid={testId}>
        <p>{state.message}</p>
        {state.affected?.length ? (
          <ul className="mt-1 list-disc pl-5 text-haze-300" data-testid="videos-afetados">
            {state.affected.map((a) => (
              <li key={a.id}>
                {a.title ?? a.id} <span className="text-haze-500">({a.status})</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }
  if (state.error) {
    return (
      <p role="alert" className="text-sm text-alert" data-testid={testId}>
        {state.error}
      </p>
    );
  }
  return null;
}

export function HuntButton({ disabled }: { disabled?: boolean }) {
  const [state, action, pending] = useActionState(huntAction, {});
  return (
    <form action={action} className="space-y-2">
      <Button type="submit" variant="secondary" disabled={pending || disabled}>
        <Search /> {pending ? 'Enfileirando...' : 'Procurar parceiros agora'}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function AddChannelForm() {
  const [state, action, pending] = useActionState(addChannelAction, {});
  return (
    <form action={action} className="space-y-2" data-testid="form-canal">
      <Label htmlFor="channelUrl">Adicionar canal pelo link</Label>
      <div className="flex gap-2">
        <Input
          id="channelUrl"
          name="channelUrl"
          placeholder="https://www.youtube.com/@canal"
          required
        />
        <Button type="submit" variant="secondary" disabled={pending}>
          <UserPlus /> Adicionar
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  );
}

/** Rascunho da mensagem: o dono copia e envia por conta própria (o sistema nunca envia). */
export function DraftMessage({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  return (
    <div className="space-y-2">
      <textarea
        ref={ref}
        readOnly
        value={text}
        rows={10}
        className="w-full rounded-lg border border-night-600 bg-night-900 p-3 text-xs text-haze-200"
        data-testid="rascunho-mensagem"
      />
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
          } catch {
            ref.current?.select();
            document.execCommand('copy');
          }
          setCopied(true);
        }}
      >
        <Copy /> {copied ? 'Copiado!' : 'Copiar mensagem'}
      </Button>
      <p className="text-xs text-haze-500">
        O estúdio nunca envia mensagens. Copie, revise e envie você mesmo.
      </p>
    </div>
  );
}

export function PermissionForm({
  partnerId,
  defaultCredit,
  defaultLink,
}: {
  partnerId: string;
  defaultCredit: string;
  defaultLink: string;
}) {
  const [state, action, pending] = useActionState(permissionAction, {});
  const today = new Date().toISOString().slice(0, 10);
  const p = (n: string) => `${partnerId}-${n}`;
  return (
    <form action={action} className="space-y-3" data-testid="form-permissao">
      <input type="hidden" name="partnerId" value={partnerId} />
      <p className="text-xs text-haze-400">
        Tipo: <strong className="text-white">cortes em Shorts de react</strong>. Frase vaga como
        &ldquo;cortes liberados&rdquo; não é permissão: registre a mensagem em que o criador
        autoriza o Radar Neon.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={p('kind')}>Como ele autorizou</Label>
          <Select id={p('kind')} name="proofKind" defaultValue="EMAIL">
            <option value="EMAIL">E-mail</option>
            <option value="DIRECT_MESSAGE">
              Mensagem direta (Instagram, Discord, WhatsApp...)
            </option>
            <option value="CONTRACT">Contrato ou termo assinado</option>
            <option value="OTHER">Outro registro escrito</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p('granted')}>Data da autorização</Label>
          <Input id={p('granted')} name="grantedAt" type="date" defaultValue={today} required />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={p('proof')}>Prova (o que ele escreveu, quando e onde)</Label>
        <textarea
          id={p('proof')}
          name="proof"
          rows={3}
          required
          className="w-full rounded-lg border border-night-600 bg-night-900 p-2 text-sm text-white"
          placeholder='Ex.: E-mail de fulano@... em 10/11: "Autorizo o Radar Neon a usar cortes dos meus vídeos em Shorts de react, com crédito e link."'
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={p('file')}>Print ou PDF da conversa (opcional, até 10 MB)</Label>
        <Input
          id={p('file')}
          name="proofFile"
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={p('credit')}>Crédito (na tela e na descrição)</Label>
          <Input id={p('credit')} name="credit" required defaultValue={defaultCredit} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p('link')}>Link do parceiro na descrição</Label>
          <Input id={p('link')} name="link" type="url" defaultValue={defaultLink} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p('hashtag')}>Hashtag pedida (opcional)</Label>
          <Input id={p('hashtag')} name="hashtag" placeholder="#canaldofulano" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p('money')}>Monetização</Label>
          <Select id={p('money')} name="monetization" defaultValue="allowed">
            <option value="allowed">Pode monetizar</option>
            <option value="not_allowed">Não pode monetizar</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p('max')}>Teto de clipe por Short (s, opcional)</Label>
          <Input id={p('max')} name="maxClipSec" type="number" min={3} max={60} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={p('exp')}>Válida até (opcional)</Label>
          <Input id={p('exp')} name="expiresAt" type="date" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={p('notes')}>Outras condições combinadas (opcional)</Label>
        <Input id={p('notes')} name="notes" maxLength={500} />
      </div>
      <label className="flex items-start gap-2 text-sm text-haze-200">
        <input type="checkbox" name="explicit" className="mt-1" />
        Confirmo que o criador autorizou o Radar Neon, por escrito, a usar cortes em Shorts de
        react.
      </label>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          <ShieldCheck /> {pending ? 'Registrando...' : 'Registrar permissão'}
        </Button>
        <Feedback state={state} testId="retorno-permissao" />
      </div>
    </form>
  );
}

export function PermissionStatusForm({
  permissionId,
  status,
}: {
  permissionId: string;
  status: 'ACTIVE' | 'SUSPENDED' | 'REVOKED';
}) {
  const [state, action, pending] = useActionState(permissionStatusAction, {});
  if (status === 'REVOKED' && !state.message) return null;
  return (
    <form action={action} className="space-y-2" data-testid="form-status-permissao">
      <input type="hidden" name="permissionId" value={permissionId} />
      {status !== 'REVOKED' ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            name="reason"
            placeholder="Motivo (obrigatório para revogar)"
            className="max-w-xs"
            aria-label="Motivo"
          />
          {status === 'ACTIVE' ? (
            <Button
              type="submit"
              name="status"
              value="SUSPENDED"
              size="sm"
              variant="secondary"
              disabled={pending}
            >
              Suspender
            </Button>
          ) : (
            <Button
              type="submit"
              name="status"
              value="ACTIVE"
              size="sm"
              variant="secondary"
              disabled={pending}
            >
              Reativar
            </Button>
          )}
          <Button
            type="submit"
            name="status"
            value="REVOKED"
            size="sm"
            variant="danger"
            disabled={pending}
          >
            Revogar
          </Button>
        </div>
      ) : null}
      <Feedback state={state} testId="retorno-status-permissao" />
    </form>
  );
}

export function ImportLinkForm({
  partnerId,
  permissions,
}: {
  partnerId: string;
  permissions: Array<{ id: string; label: string }>;
}) {
  const [state, action, pending] = useActionState(importLinkAction, {});
  return (
    <form action={action} className="space-y-2" data-testid="form-importar-link">
      <input type="hidden" name="partnerId" value={partnerId} />
      <input type="hidden" name="permissionId" value={permissions[0]?.id ?? ''} />
      <Label htmlFor={`${partnerId}-url`}>
        Link do Dropbox ou do Google Drive (arquivo ou pasta)
      </Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={`${partnerId}-url`}
          name="url"
          type="url"
          required
          placeholder="https://www.dropbox.com/scl/fi/..."
        />
        <Input
          name="title"
          placeholder="Título (opcional)"
          aria-label="Título"
          className="sm:max-w-48"
        />
        <Button type="submit" variant="secondary" disabled={pending || permissions.length === 0}>
          <Link2 /> Importar
        </Button>
      </div>
      <p className="text-xs text-haze-500">
        Nunca do YouTube: peça ao parceiro o arquivo original.
      </p>
      <Feedback state={state} testId="retorno-importar" />
    </form>
  );
}

/** Envio direto pelo painel (XHR para mostrar o progresso; o arquivo vai em fluxo ao S3). */
export function UploadVideoForm({
  partnerId,
  permissionId,
  maxMb,
}: {
  partnerId: string;
  permissionId: string | null;
  maxMb: number;
}) {
  const [progress, setProgress] = useState<number | null>(null);
  const [state, setState] = useState<PartnerActionState>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function send() {
    const file = fileRef.current?.files?.[0];
    if (!file || !permissionId) return;
    if (file.size > maxMb * 1_048_576) {
      setState({ error: `Arquivo maior que ${maxMb} MB.` });
      return;
    }
    const qs = new URLSearchParams({
      partnerId,
      permissionId,
      name: file.name,
      title: titleRef.current?.value ?? '',
    });
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/partners/upload?${qs}`);
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setProgress(null);
      let body: { error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as { error?: string };
      } catch {
        /* resposta vazia */
      }
      if (xhr.status === 201) {
        setState({
          ok: true,
          message: 'Arquivo recebido: conferindo e analisando (recarregue em instantes).',
        });
        if (fileRef.current) fileRef.current.value = '';
      } else {
        setState({ error: body.error ?? `Falhou (HTTP ${xhr.status}).` });
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setState({ error: 'A conexão caiu durante o envio.' });
    };
    setState({});
    setProgress(0);
    xhr.send(file);
  }

  return (
    <div className="space-y-2" data-testid="form-enviar-video">
      <Label htmlFor={`${partnerId}-file`}>Ou envie o arquivo (até {maxMb} MB)</Label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          id={`${partnerId}-file`}
          ref={fileRef}
          type="file"
          accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mkv"
        />
        <Input
          ref={titleRef}
          placeholder="Título (opcional)"
          aria-label="Título do envio"
          className="sm:max-w-48"
        />
        <Button
          type="button"
          variant="secondary"
          disabled={progress !== null || !permissionId}
          onClick={send}
        >
          <Upload /> {progress !== null ? `${progress}%` : 'Enviar'}
        </Button>
      </div>
      <Feedback state={state} testId="retorno-envio" />
    </div>
  );
}

export function ReactButton({
  assetId,
  disabled,
  reason,
}: {
  assetId: string;
  disabled: boolean;
  reason?: string;
}) {
  const [state, action, pending] = useActionState(reactAction, {});
  return (
    <form action={action} className="space-y-1">
      <input type="hidden" name="assetId" value={assetId} />
      <Button type="submit" size="sm" disabled={disabled || pending} title={reason}>
        <Clapperboard /> {pending ? 'Enfileirando...' : 'Produzir Short de react'}
      </Button>
      <Feedback state={state} testId="retorno-react" />
    </form>
  );
}

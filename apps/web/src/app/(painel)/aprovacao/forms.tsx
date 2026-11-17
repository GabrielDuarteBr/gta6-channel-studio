'use client';

import { Ban, CheckCheck, RefreshCw, Save, Undo2 } from 'lucide-react';
import { ActionForm } from '@/components/action-form';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import {
  approveAction,
  cancelPublicationAction,
  manualUploadedAction,
  rejectAction,
  retryUploadAction,
  saveMetadataAction,
} from './actions';

const textarea =
  'w-full rounded-lg border border-night-600 bg-night-900 p-3 text-sm text-white focus:border-neon-cyan focus:outline-none';

export function MetadataForm({
  productionId,
  title,
  description,
  tags,
}: {
  productionId: string;
  title: string;
  description: string;
  tags: string[];
}) {
  return (
    <ActionForm action={saveMetadataAction} testId="form-metadados">
      {(pending) => (
        <>
          <input type="hidden" name="productionId" value={productionId} />
          <div className="space-y-1">
            <Label htmlFor={`t-${productionId}`}>Título ({title.length}/100)</Label>
            <Input id={`t-${productionId}`} name="title" defaultValue={title} maxLength={100} />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`d-${productionId}`}>Descrição (fontes, créditos e aviso de IA)</Label>
            <textarea
              id={`d-${productionId}`}
              name="description"
              defaultValue={description}
              rows={8}
              maxLength={5000}
              className={textarea}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`g-${productionId}`}>Tags (separadas por vírgula)</Label>
            <Input id={`g-${productionId}`} name="tags" defaultValue={tags.join(', ')} />
          </div>
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            <Save /> {pending ? 'Salvando…' : 'Salvar e conferir de novo'}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function ApproveForm({
  productionId,
  defaultAt,
  disabled,
  modeHint,
}: {
  productionId: string;
  /** "YYYY-MM-DDTHH:MM" em Brasília */
  defaultAt: string;
  disabled: boolean;
  modeHint: string;
}) {
  return (
    <ActionForm action={approveAction} testId="form-aprovar">
      {(pending) => (
        <>
          <input type="hidden" name="productionId" value={productionId} />
          <div className="space-y-1">
            <Label htmlFor={`a-${productionId}`}>Publicar em (horário de Brasília)</Label>
            <Input
              id={`a-${productionId}`}
              type="datetime-local"
              name="publishAt"
              defaultValue={defaultAt}
              className="max-w-xs"
            />
          </div>
          <p className="text-xs text-haze-400">{modeHint}</p>
          <Button type="submit" size="sm" disabled={pending || disabled} data-testid="aprovar">
            <CheckCheck /> {pending ? 'Aprovando…' : 'Aprovar e agendar'}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function RejectForm({ productionId }: { productionId: string }) {
  return (
    <ActionForm action={rejectAction} className="flex flex-wrap items-end gap-2 space-y-0">
      {(pending) => (
        <>
          <input type="hidden" name="productionId" value={productionId} />
          <Input name="reason" placeholder="Motivo (opcional)" className="h-8 max-w-xs text-xs" />
          <Button type="submit" size="sm" variant="ghost" disabled={pending}>
            <Ban /> Rejeitar
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function CancelPublicationForm({ publicationId }: { publicationId: string }) {
  return (
    <ActionForm action={cancelPublicationAction} className="space-y-1">
      {(pending) => (
        <>
          <input type="hidden" name="publicationId" value={publicationId} />
          <Button type="submit" size="sm" variant="ghost" disabled={pending}>
            <Undo2 /> Cancelar
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function RetryUploadForm({ publicationId }: { publicationId: string }) {
  return (
    <ActionForm action={retryUploadAction} className="space-y-1">
      {(pending) => (
        <>
          <input type="hidden" name="publicationId" value={publicationId} />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            <RefreshCw /> Tentar de novo
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function ManualUploadedForm({ publicationId }: { publicationId: string }) {
  return (
    <ActionForm
      action={manualUploadedAction}
      className="flex flex-wrap items-start gap-2 space-y-0"
    >
      {(pending) => (
        <>
          <input type="hidden" name="publicationId" value={publicationId} />
          <Input
            name="url"
            placeholder="Link do vídeo no YouTube (depois de enviar)"
            className="h-8 max-w-sm text-xs"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={pending}>
            Já enviei
          </Button>
        </>
      )}
    </ActionForm>
  );
}

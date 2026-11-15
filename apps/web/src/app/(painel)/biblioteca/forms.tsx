'use client';

import { Ban, Link2, Upload } from 'lucide-react';
import { useActionState, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Toggle } from '@/components/ui/input';
import {
  importOfficialAction,
  revokeAssetAction,
  uploadAssetAction,
  type LibraryActionState,
} from './actions';

function Feedback({ state }: { state: LibraryActionState }) {
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

interface StoryOption {
  id: string;
  title: string;
}

/** Campos comuns do manifesto (licença, crédito, prova, restrições, história). */
function ManifestFields({
  prefix,
  stories,
  licenseDefault,
  creditDefault,
  proofHint,
}: {
  prefix: string;
  stories: StoryOption[];
  licenseDefault: string;
  creditDefault?: string;
  proofHint: string;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-title`}>Título</Label>
          <Input id={`${prefix}-title`} name="title" required minLength={3} maxLength={140} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-tags`}>Etiquetas (separadas por vírgula)</Label>
          <Input id={`${prefix}-tags`} name="tags" placeholder="trailer, praia, carro" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-license`}>Licença / base de uso</Label>
          <Input
            id={`${prefix}-license`}
            name="license"
            required
            minLength={3}
            defaultValue={licenseDefault}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${prefix}-credit`}>Crédito na tela e na descrição</Label>
          <Input
            id={`${prefix}-credit`}
            name="credit"
            defaultValue={creditDefault}
            placeholder="ex.: Rockstar Games"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${prefix}-proof`}>Prova / de onde veio</Label>
          <Input id={`${prefix}-proof`} name="proof" placeholder={proofHint} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${prefix}-story`}>História da Pauta (opcional)</Label>
          <Select id={`${prefix}-story`} name="storyId" defaultValue="">
            <option value="">— nenhuma —</option>
            {stories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Toggle
          name="editorialOnly"
          defaultChecked
          label="Só uso editorial"
          description="Notícia/comentário; nada de anúncio."
        />
        <Toggle
          name="allowThumbnail"
          defaultChecked
          label="Pode ir na thumbnail"
          description="Desligue se a licença não permitir."
        />
      </div>
    </>
  );
}

const ORIGIN_HELP: Record<string, { license: string; proof: string; needsUrl: boolean }> = {
  OWNER_UPLOAD: {
    license: 'Própria (feita/fotografada pelo dono)',
    proof: 'ex.: arte feita por mim no Photoshop',
    needsUrl: false,
  },
  OFFICIAL_PRESS: {
    license: 'Imprensa oficial — uso editorial',
    proof: 'ex.: imagem do comunicado de 15/11 no Newswire',
    needsUrl: true,
  },
  CHANNEL_OWN: {
    license: 'Material do próprio canal',
    proof: 'ex.: quadro do nosso vídeo de 10/11',
    needsUrl: false,
  },
};

export function UploadForm({ stories }: { stories: StoryOption[] }) {
  const [state, action, pending] = useActionState<LibraryActionState, FormData>(
    uploadAssetAction,
    {},
  );
  const [origin, setOrigin] = useState('OWNER_UPLOAD');
  const help = ORIGIN_HELP[origin]!;
  return (
    <form action={action} className="space-y-4" data-testid="form-envio">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="up-file">Imagem (PNG, JPEG ou WebP, até 20 MB)</Label>
          <Input
            id="up-file"
            name="file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
            className="pt-2"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="up-origin">Origem</Label>
          <Select
            id="up-origin"
            name="origin"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
          >
            <option value="OWNER_UPLOAD">Enviada por mim (arte/foto própria)</option>
            <option value="OFFICIAL_PRESS">Imprensa oficial (Rockstar/Take-Two)</option>
            <option value="CHANNEL_OWN">Material do próprio canal</option>
          </Select>
        </div>
        {help.needsUrl ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="up-source">Link da página oficial de onde a imagem veio</Label>
            <Input
              id="up-source"
              name="sourceUrl"
              type="url"
              required
              placeholder="https://www.rockstargames.com/newswire/..."
            />
          </div>
        ) : null}
      </div>
      <ManifestFields
        key={origin}
        prefix="up"
        stories={stories}
        licenseDefault={help.license}
        proofHint={help.proof}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Upload /> Enviar para a Biblioteca
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function ImportForm({ stories }: { stories: StoryOption[] }) {
  const [state, action, pending] = useActionState<LibraryActionState, FormData>(
    importOfficialAction,
    {},
  );
  return (
    <form action={action} className="space-y-4" data-testid="form-importar">
      <div className="space-y-1.5">
        <Label htmlFor="im-url">Link direto da imagem no site oficial</Label>
        <Input
          id="im-url"
          name="url"
          type="url"
          required
          placeholder="https://www.rockstargames.com/.../imagem.jpg"
        />
        <p className="text-xs text-haze-500">
          Só rockstargames.com e take2games.com. Links do YouTube são sempre recusados.
        </p>
      </div>
      <ManifestFields
        prefix="im"
        stories={stories}
        licenseDefault="Imprensa oficial — uso editorial"
        creditDefault="Rockstar Games"
        proofHint="ex.: imagem do comunicado de 15/11"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Link2 /> Importar
        </Button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export function RevokeForm({ assetId, active }: { assetId: string; active: boolean }) {
  const [state, action, pending] = useActionState<LibraryActionState, FormData>(
    revokeAssetAction,
    {},
  );
  return (
    <form action={action} className="space-y-2" data-testid="form-revogar">
      {active ? (
        <>
          <input type="hidden" name="assetId" value={assetId} />
          <div className="flex gap-2">
            <Input
              name="reason"
              aria-label="Motivo da revogação"
              placeholder="Motivo (ex.: parceiro pediu)"
              className="h-8 text-xs"
              required
              minLength={3}
            />
            <Button
              type="submit"
              variant="secondary"
              size="sm"
              disabled={pending}
              className="text-xs"
            >
              <Ban /> Revogar
            </Button>
          </div>
        </>
      ) : null}
      <Feedback state={state} />
    </form>
  );
}

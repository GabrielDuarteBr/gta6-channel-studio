import { DEFAULT_PIVOTS, pivotsSchema, type ArtFileInput, type ArtPackRef } from '@studio/avatar';
import {
  activateArt,
  artPackRef,
  deactivateArt,
  getPrisma,
  saveArtPack,
  type CharacterArt,
} from '@studio/db';
import { objectStore } from './library';

/** Arte do artista no painel: enviar o pacote, ver a prévia, ativar ou voltar à provisória. */

export function listArt(take = 6): Promise<CharacterArt[]> {
  return getPrisma().characterArt.findMany({ orderBy: { version: 'desc' }, take });
}

/** Referência para a prévia no painel: arquivos servidos por /api/character-art/v<versão>/. */
export function panelArtRef(row: CharacterArt): ArtPackRef {
  return artPackRef(row, `v${row.version}`);
}

export const PANEL_ART_BASE = '/api/character-art';

function proofKind(bytes: Uint8Array): { mime: string; ext: string } | null {
  const head = Array.from(bytes.slice(0, 4));
  if (head.join() === [0x25, 0x50, 0x44, 0x46].join())
    return { mime: 'application/pdf', ext: 'pdf' };
  if (head.join() === [0x89, 0x50, 0x4e, 0x47].join()) return { mime: 'image/png', ext: 'png' };
  if (head[0] === 0xff && head[1] === 0xd8) return { mime: 'image/jpeg', ext: 'jpg' };
  return null;
}

export class ProofError extends Error {
  override name = 'ProofError';
}

export async function uploadArt(form: FormData, actor = 'owner') {
  const layers: ArtFileInput[] = [];
  for (const v of form.getAll('layers')) {
    if (v instanceof File && v.size > 0) {
      layers.push({ name: v.name, bytes: new Uint8Array(await v.arrayBuffer()) });
    }
  }
  let proof: { bytes: Uint8Array; mime: string; ext: string } | null = null;
  const pf = form.get('proof');
  if (pf instanceof File && pf.size > 0) {
    if (pf.size > 8 * 1024 * 1024) throw new ProofError('O arquivo do contrato passa de 8 MB.');
    const bytes = new Uint8Array(await pf.arrayBuffer());
    const kind = proofKind(bytes);
    if (!kind) throw new ProofError('O contrato precisa ser PDF, PNG ou JPG.');
    proof = { bytes, ...kind };
  }
  const num = (name: string, fallback: number) => {
    const v = Number(String(form.get(name) ?? '').replace(',', '.'));
    return Number.isFinite(v) && String(form.get(name) ?? '').trim() !== '' ? v : fallback;
  };
  const pivots = pivotsSchema.parse({
    head: [num('headX', DEFAULT_PIVOTS.head[0]), num('headY', DEFAULT_PIVOTS.head[1])],
    arm: [num('armX', DEFAULT_PIVOTS.arm[0]), num('armY', DEFAULT_PIVOTS.arm[1])],
  });
  return saveArtPack(getPrisma(), objectStore(), {
    files: layers,
    artist: String(form.get('artist') ?? ''),
    rightsProof: String(form.get('rightsProof') ?? ''),
    proof,
    pivots,
    actor,
  });
}

export async function setActiveArt(version: number | null) {
  if (version === null) await deactivateArt(getPrisma());
  else await activateArt(getPrisma(), version);
}

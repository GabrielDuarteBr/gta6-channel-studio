import { getPrisma, type AssetOrigin } from '@studio/db';
import { assertMediaImportAllowed, isOfficialPressHost, isPublicHttpsUrl } from '@studio/policy';
import { parseEnv, s3EnvSchema } from '@studio/shared';
import { MAX_IMAGE_BYTES, S3ObjectStore, type ObjectStore } from '@studio/storage';

const globalStore = globalThis as unknown as { __studioStore?: ObjectStore };

/** Cliente S3 único por processo (SeaweedFS no notebook). */
export function objectStore(): ObjectStore {
  if (!globalStore.__studioStore) {
    globalStore.__studioStore = new S3ObjectStore(parseEnv(s3EnvSchema));
  }
  return globalStore.__studioStore;
}

export const ORIGIN_LABEL: Record<AssetOrigin, string> = {
  OFFICIAL_PRESS: 'Imprensa oficial',
  PARTNER: 'Parceiro',
  IMAGE_PROVIDER: 'Gerada (Google)',
  OWNER_UPLOAD: 'Enviada pelo dono',
  CHANNEL_OWN: 'Do próprio canal',
};

export interface LibraryFilter {
  origin?: AssetOrigin | undefined;
  q?: string | undefined;
}

export async function listAssets(filter: LibraryFilter = {}, take = 60) {
  const q = filter.q?.trim();
  return getPrisma().asset.findMany({
    where: {
      ...(filter.origin ? { origin: filter.origin } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: 'insensitive' } },
              { tags: { has: q.toLowerCase() } },
            ],
          }
        : {}),
    },
    include: {
      manifest: true,
      story: { select: { id: true, title: true, titlePt: true } },
      _count: { select: { usages: true } },
    },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

export async function libraryCounts() {
  const rows = await getPrisma().asset.groupBy({ by: ['origin'], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.origin, r._count._all])) as Partial<
    Record<AssetOrigin, number>
  >;
}

/** Histórias recentes para ligar uma mídia a uma pauta. */
export async function storiesForSelect(take = 30) {
  return getPrisma().story.findMany({
    where: { status: { not: 'DISMISSED' } },
    select: { id: true, title: true, titlePt: true },
    orderBy: { lastSeenAt: 'desc' },
    take,
  });
}

export class ImportError extends Error {
  override name = 'ImportError';
}

/**
 * Baixa uma imagem de um site oficial (Rockstar/Take-Two), com limite de tamanho e tempo.
 * Recusa YouTube e endereços internos, inclusive depois de redirecionamentos.
 */
export async function fetchOfficialImage(
  rawUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
  const first = assertMediaImportAllowed(rawUrl);
  if (!isOfficialPressHost(first.hostname)) {
    throw new ImportError(`${first.hostname} não é um site oficial da Rockstar ou da Take-Two.`);
  }
  let url = first.toString();
  for (let hop = 0; hop < 4; hop++) {
    if (!isPublicHttpsUrl(url)) throw new ImportError('endereço não permitido');
    assertMediaImportAllowed(url);
    const res = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
      headers: { accept: 'image/png,image/jpeg,image/webp' },
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) throw new ImportError('redirecionamento sem destino');
      url = new URL(next, url).toString();
      continue;
    }
    if (!res.ok) throw new ImportError(`o site respondeu HTTP ${res.status}`);
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_IMAGE_BYTES) throw new ImportError('imagem maior que 20 MB');
    const reader = res.body?.getReader();
    if (!reader) throw new ImportError('resposta vazia');
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new ImportError('imagem maior que 20 MB');
      }
      parts.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.byteLength;
    }
    return out;
  }
  throw new ImportError('redirecionamentos demais');
}

import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { audit, getAllSettings, type Prisma, type PrismaClient } from '@studio/db';
import {
  assertPartnerPermission,
  detectContentFlags,
  parseShareLink,
  PolicyViolation,
  type PartnerConditions,
  type PermissionState,
} from '@studio/policy';
import type { Logger } from '@studio/shared';
import { addVideoAsset, type ObjectStore } from '@studio/storage';
import { z } from 'zod';
import type { MediaService, VideoAnalysis } from '../character/services';
import {
  downloadShareLink,
  DownloadError,
  sniffMedia,
  workFile,
  WORK_ROOT,
  type DownloadedFile,
  type FetchLike,
} from './download';

/**
 * Importação dos arquivos do parceiro (fila "media"): confere a permissão de novo (3ª camada),
 * baixa do Dropbox/Drive ou pega o envio do painel no S3, confere que é vídeo, guarda na
 * Biblioteca com manifesto ligado à permissão e pede a análise (transcrição, fala, música).
 */

export { ANALYZE_JOB, PARTNER_IMPORT_JOB } from '@studio/queue';
export const partnerImportJobSchema = z.object({ importId: z.string().min(8).max(40) });
export const analyzeJobSchema = z.object({ assetId: z.string().min(8).max(40) });

export interface PartnerContext {
  prisma: PrismaClient;
  log: Logger;
  store: ObjectStore;
  media: MediaService;
  driveKey?: string | undefined;
  fetchImpl?: FetchLike;
  /** Pasta de trabalho (testes usam uma temporária). */
  workRoot?: string;
  enqueueAnalysis: (assetId: string) => Promise<void>;
  now?: () => Date;
}

export function permissionState(p: {
  id: string;
  type: string;
  status: string;
  expiresAt: Date | null;
}): PermissionState {
  return {
    id: p.id,
    type: p.type as PermissionState['type'],
    status: p.status as PermissionState['status'],
    expiresAt: p.expiresAt,
  };
}

/** Onde o vídeo do parceiro fica na pasta de trabalho (cópia do S3 para cortar e analisar). */
export const partnerVideoPath = (sha256: string, ext: string) => `partners/${sha256}.${ext}`;

/** Garante a cópia local do vídeo (baixa do S3 se a pasta de trabalho foi limpa). */
export async function ensureLocalVideo(
  ctx: Pick<PartnerContext, 'store' | 'workRoot'>,
  asset: { sha256: string; storageKey: string },
): Promise<string> {
  const ext = path.extname(asset.storageKey).slice(1) || 'mp4';
  const rel = partnerVideoPath(asset.sha256, ext);
  const full = workFile(rel, ctx.workRoot ?? WORK_ROOT);
  const ok = await stat(full).then(
    (s) => s.isFile() && s.size > 0,
    () => false,
  );
  if (!ok) {
    await mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.part`;
    await pipeline(await ctx.store.getStream(asset.storageKey), createWriteStream(tmp));
    await rename(tmp, full);
  }
  return rel;
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

export async function runPartnerImport(
  ctx: PartnerContext,
  importId: string,
): Promise<{ status: string; assets: string[]; notes: string[] }> {
  const { prisma, log } = ctx;
  const now = ctx.now?.() ?? new Date();
  const root = ctx.workRoot ?? WORK_ROOT;
  const imp = await prisma.partnerImport.findUniqueOrThrow({
    where: { id: importId },
    include: { permission: true, partner: true },
  });
  if (imp.status === 'DONE') return { status: 'DONE', assets: imp.assetIds, notes: [] };
  const settings = await getAllSettings(prisma);
  const dir = `imports/${imp.id}`;
  const notes: string[] = [];
  const setImport = (data: Prisma.PartnerImportUpdateInput) =>
    prisma.partnerImport.update({ where: { id: imp.id }, data });

  try {
    // 3ª camada: a permissão continua ativa e cobre cortes para react?
    assertPartnerPermission(permissionState(imp.permission), 'REACT_CLIPS', now);
    if (imp.permission.partnerId !== imp.partnerId) {
      throw new PolicyViolation('PARTNER_PERMISSION_ACTIVE', 'A permissão é de outro parceiro.');
    }
    const conditions = imp.permission.conditions as unknown as PartnerConditions;
    const maxBytes = settings.partners.maxImportMb * 1_048_576;
    await setImport({ status: 'DOWNLOADING', step: 'baixando', error: null });

    let files: DownloadedFile[];
    if (imp.source === 'upload') {
      if (!imp.incomingKey) throw new DownloadError('envio sem arquivo');
      const rel = `${dir}/envio`;
      const full = workFile(rel, root);
      await mkdir(path.dirname(full), { recursive: true });
      await pipeline(await ctx.store.getStream(imp.incomingKey), createWriteStream(full));
      const size = (await stat(full)).size;
      if (size > maxBytes) throw new DownloadError('arquivo maior que o limite');
      files = [{ path: rel, name: imp.originalName ?? 'video', bytes: size }];
    } else {
      const link = parseShareLink(imp.url ?? '');
      files = await downloadShareLink(link, {
        dir,
        maxBytes,
        driveKey: ctx.driveKey,
        fetchImpl: ctx.fetchImpl,
        root,
      });
    }

    await setImport({ status: 'PROCESSING', step: 'conferindo os vídeos' });
    // Pasta do Dropbox chega como .zip: tira só os vídeos.
    const expanded: DownloadedFile[] = [];
    for (const f of files) {
      const kind = await sniffMedia(workFile(f.path, root));
      if (kind === 'zip') {
        const r = await ctx.media.extractVideos(f.path, `${dir}/pasta`, 20);
        expanded.push(...r.files.map((x) => ({ path: x.path, name: x.name, bytes: x.bytes })));
      } else {
        expanded.push(f);
      }
    }
    if (expanded.length === 0) throw new DownloadError('nenhum vídeo encontrado no link');

    const assets: string[] = [];
    for (const [i, f] of expanded.entries()) {
      const full = workFile(f.path, root);
      const kind = await sniffMedia(full);
      if (!kind || kind === 'zip') {
        notes.push(`"${f.name}" não é vídeo (mp4, mov, mkv ou webm): ignorado`);
        continue;
      }
      const flags = detectContentFlags(`${f.name} ${imp.title ?? ''}`);
      if (flags.leak || flags.onlineCheats || flags.mods) {
        notes.push(`"${f.name}" parece vazamento, trapaça ou mod (política da Rockstar): recusado`);
        continue;
      }
      const named = `${dir}/video-${i}.${kind}`;
      await rename(full, workFile(named, root));
      const probe = await ctx.media.probe(named);
      if (probe.duration_sec > settings.partners.maxClipMinutes * 60) {
        notes.push(
          `"${f.name}" tem ${Math.round(probe.duration_sec / 60)} min (máximo ${settings.partners.maxClipMinutes}): ignorado`,
        );
        continue;
      }
      const title =
        (expanded.length === 1 && imp.title ? imp.title : null) ??
        f.name.replace(/\.[a-z0-9]{2,4}$/i, '').slice(0, 140);
      const added = await addVideoAsset(prisma, ctx.store, {
        filePath: workFile(named, root),
        ext: kind,
        title,
        originalName: f.name,
        origin: 'PARTNER',
        partnerId: imp.partnerId,
        durationSec: probe.duration_sec,
        width: probe.width,
        height: probe.height,
        manifest: {
          license: 'Permissão do parceiro: cortes em Shorts de react, com crédito',
          credit: conditions.credit,
          proof: `Permissão ${imp.permission.id} (${imp.permission.proofKind}, ${imp.permission.grantedAt.toISOString().slice(0, 10)})`,
          sourceUrl: imp.source === 'upload' ? null : imp.url,
          restrictions: { mustCredit: true, editorialOnly: true },
          expiresAt: imp.permission.expiresAt,
          permissionId: imp.permission.id,
          permission: permissionState(imp.permission),
        },
        createdBy: 'agent:importador',
      });
      // Cópia de trabalho com nome pelo conteúdo (o corte e a análise usam esta).
      const local = workFile(partnerVideoPath(added.sha256, kind), root);
      await mkdir(path.dirname(local), { recursive: true });
      await rename(workFile(named, root), local);
      assets.push(added.asset.id);
      if (!added.duplicate) await ctx.enqueueAnalysis(added.asset.id);
      else notes.push(`"${f.name}" já estava na Biblioteca`);
    }
    if (assets.length === 0) throw new DownloadError(notes.join('; ') || 'nenhum vídeo aceito');

    await setImport({
      status: 'DONE',
      step: notes.length ? notes.join('; ').slice(0, 500) : null,
      assetIds: assets,
    });
    if (imp.incomingKey) await ctx.store.delete(imp.incomingKey).catch(() => undefined);
    await audit(prisma, {
      actor: 'agent:importador',
      action: 'partner.import',
      target: imp.id,
      details: { partnerId: imp.partnerId, assets, notes },
    });
    log.info({ importId: imp.id, assets: assets.length }, 'arquivos do parceiro importados');
    return { status: 'DONE', assets, notes };
  } catch (err) {
    const permanent =
      err instanceof PolicyViolation || (err instanceof DownloadError && err.permanent);
    await setImport({
      status: permanent ? 'FAILED' : 'QUEUED',
      step: permanent ? null : 'nova tentativa em breve',
      error: (err as Error).message.slice(0, 500),
    });
    // Falha definitiva: o envio temporário do painel não serve mais.
    if (permanent && imp.incomingKey)
      await ctx.store.delete(imp.incomingKey).catch(() => undefined);
    if (err instanceof PolicyViolation) {
      await audit(prisma, {
        actor: 'agent:importador',
        action: 'partner.import',
        target: imp.id,
        outcome: 'DENIED',
        details: { rule: err.rule, message: err.message },
      });
    }
    throw err;
  } finally {
    await rm(workFile(dir, root), { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Análise do vídeo (fila "media"): transcrição, fala, música, cenas e nível de áudio. */
export async function runAnalyze(
  ctx: Pick<PartnerContext, 'prisma' | 'log' | 'store' | 'media' | 'workRoot'>,
  assetId: string,
): Promise<{ status: string; segments?: number }> {
  const asset = await ctx.prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
  if (asset.kind !== 'VIDEO') throw new Error('só vídeos são analisados');
  if (asset.analysisStatus === 'READY' && asset.analysis) return { status: 'READY' };
  await ctx.prisma.asset.update({
    where: { id: assetId },
    data: { analysisStatus: 'RUNNING', analysisError: null },
  });
  try {
    const local = await ensureLocalVideo(ctx, asset);
    const analysis: VideoAnalysis = await ctx.media.analyze(local);
    await ctx.prisma.asset.update({
      where: { id: assetId },
      data: {
        analysis: json(analysis),
        analysisStatus: 'READY',
        durationSec: analysis.durationSec,
      },
    });
    ctx.log.info({ assetId, segments: analysis.segments.length }, 'vídeo analisado');
    return { status: 'READY', segments: analysis.segments.length };
  } catch (err) {
    await ctx.prisma.asset.update({
      where: { id: assetId },
      data: { analysisStatus: 'FAILED', analysisError: (err as Error).message.slice(0, 500) },
    });
    throw err;
  }
}

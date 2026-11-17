import { readFile, stat } from 'node:fs/promises';
import { audit, getAllSettings, type PrismaClient } from '@studio/db';
import {
  assertAssetRenderable,
  PolicyViolation,
  type AssetOriginId,
  type ComplianceReport,
} from '@studio/policy';
import { YouTubeError, type YouTubePublisher } from '@studio/providers';
import type { Logger } from '@studio/shared';
import { z } from 'zod';
import { workFile, WORK_ROOT } from '../partners/download';
import { permissionState } from '../partners/import';
import { NotConnectedError } from './youtube';

/**
 * Envio ao YouTube (fila "upload"). 3ª camada: confere de novo, no banco, a Conformidade e os
 * direitos de cada mídia antes de mandar. Sempre PRIVADO com data marcada e marca de conteúdo
 * sintético (insertBody). A sessão resumable fica salva: se o notebook dormir, retoma do byte em
 * que parou. Modo simulado: nada sai do computador.
 */

export const uploadJobSchema = z.object({ publicationId: z.string().min(8).max(40) });

export interface UploadContext {
  prisma: PrismaClient;
  log: Logger;
  publisher: () => Promise<YouTubePublisher>;
  workRoot?: string;
  now?: () => Date;
}

/** Falhas que não melhoram tentando de novo (regra, canal desconectado, erro permanente da API). */
export function isPermanentUploadError(err: unknown): boolean {
  return (
    err instanceof PolicyViolation ||
    err instanceof NotConnectedError ||
    (err instanceof YouTubeError && !err.retryable)
  );
}

export async function runUpload(ctx: UploadContext, publicationId: string) {
  const { prisma, log } = ctx;
  const now = ctx.now?.() ?? new Date();
  const pub = await prisma.publication.findUniqueOrThrow({
    where: { id: publicationId },
    include: {
      production: {
        include: {
          assets: {
            include: { asset: { include: { manifest: { include: { permission: true } } } } },
          },
        },
      },
    },
  });
  if (['SCHEDULED', 'PUBLISHED', 'CANCELED', 'MANUAL'].includes(pub.status)) {
    return { status: pub.status, youtubeVideoId: pub.youtubeVideoId };
  }
  const setPub = (data: Parameters<typeof prisma.publication.update>[0]['data']) =>
    prisma.publication.update({ where: { id: pub.id }, data });

  try {
    // 3ª camada: Conformidade ok e direitos em dia AGORA.
    const report = pub.production.compliance as ComplianceReport | null;
    if (!report?.ok) {
      throw new PolicyViolation('HUMAN_APPROVAL', 'A Conformidade não aprovou este vídeo.');
    }
    for (const u of pub.production.assets) {
      assertAssetRenderable(
        {
          id: u.asset.id,
          origin: u.asset.origin as AssetOriginId,
          manifest: u.asset.manifest
            ? {
                origin: u.asset.manifest.origin as AssetOriginId,
                license: u.asset.manifest.license,
                status: u.asset.manifest.status,
                expiresAt: u.asset.manifest.expiresAt,
              }
            : null,
          permission: u.asset.manifest?.permission
            ? permissionState(u.asset.manifest.permission)
            : null,
        },
        now,
      );
    }
    if (pub.publishAt.getTime() <= now.getTime()) {
      throw new PolicyViolation(
        'HUMAN_APPROVAL',
        'A data de publicação já passou: escolha outra na Aprovação.',
      );
    }
    const outputs = (pub.production.outputs ?? {}) as { video?: string; thumbnail?: string | null };
    if (!outputs.video) throw new Error('produção sem vídeo');
    const root = ctx.workRoot ?? WORK_ROOT;
    const videoPath = workFile(outputs.video, root);

    if (pub.simulated) {
      await setPub({
        status: 'SCHEDULED',
        youtubeVideoId: `SIMULADO-${pub.id.slice(-8)}`,
        step: 'envio simulado (modo simulado ligado): nada saiu do computador',
        error: null,
      });
      await audit(prisma, {
        actor: 'agent:publicador',
        action: 'publish.upload',
        target: pub.id,
        details: { simulated: true, publishAt: pub.publishAt.toISOString() },
      });
      return { status: 'SCHEDULED', simulated: true };
    }

    const yt = await ctx.publisher();
    const settings = await getAllSettings(prisma);
    const size = (await stat(videoPath)).size;
    await setPub({ status: 'UPLOADING', step: 'enviando ao YouTube', error: null });
    let uploadUri = pub.uploadUri;
    let from = 0;
    if (uploadUri) {
      try {
        const st = await yt.uploadStatus(uploadUri, size);
        if (st.videoId) {
          await setPub({ youtubeVideoId: st.videoId, uploadedBytes: size });
          return finish(st.videoId);
        }
        from = st.next;
      } catch (err) {
        if (err instanceof YouTubeError && err.reason === 'sessionExpired') uploadUri = null;
        else throw err;
      }
    }
    if (!uploadUri) {
      uploadUri = await yt.startUpload(
        {
          title: pub.title,
          description: pub.description,
          tags: pub.tags,
          categoryId: pub.categoryId,
          publishAt: pub.publishAt,
        },
        size,
        'video/mp4',
        settings.youtube.notifySubscribers,
      );
      await setPub({ uploadUri, uploadedBytes: 0 });
    }
    let lastSaved = 0;
    const videoId = await yt.uploadFile(uploadUri, videoPath, from, async (p) => {
      if (p.uploadedBytes - lastSaved >= 16 * 1024 * 1024 || p.uploadedBytes === p.totalBytes) {
        lastSaved = p.uploadedBytes;
        await setPub({
          uploadedBytes: p.uploadedBytes,
          step: `enviando ao YouTube (${Math.round((p.uploadedBytes / p.totalBytes) * 100)}%)`,
        });
      }
    });
    await setPub({ youtubeVideoId: videoId, uploadedBytes: size });
    return finish(videoId);

    async function finish(id: string) {
      let thumbNote: string | null = null;
      if (outputs.thumbnail && pub.production.format === 'LONG') {
        try {
          await yt.setThumbnail(id, await readFile(workFile(outputs.thumbnail, root)), 'image/png');
          await setPub({ thumbnailSet: true });
        } catch (err) {
          thumbNote = `thumbnail não aplicada (${(err as Error).message.slice(0, 120)}); aplique no YouTube Studio`;
        }
      }
      await setPub({ status: 'SCHEDULED', step: thumbNote, uploadUri: null, error: null });
      await audit(prisma, {
        actor: 'agent:publicador',
        action: 'publish.upload',
        target: pub.id,
        details: {
          youtubeVideoId: id,
          publishAt: pub.publishAt.toISOString(),
          thumbnail: !thumbNote,
        },
      });
      log.info(
        { publicationId: pub.id, youtubeVideoId: id },
        'enviado ao YouTube (privado, agendado)',
      );
      return { status: 'SCHEDULED', youtubeVideoId: id };
    }
  } catch (err) {
    const permanent = isPermanentUploadError(err);
    await setPub({
      status: permanent ? 'FAILED' : 'QUEUED',
      step: permanent ? null : 'nova tentativa em breve',
      error: (err as Error).message.slice(0, 500),
    });
    if (err instanceof PolicyViolation) {
      await audit(prisma, {
        actor: 'agent:publicador',
        action: 'publish.upload',
        target: pub.id,
        outcome: 'DENIED',
        details: { rule: err.rule, message: err.message },
      });
    }
    throw err;
  }
}

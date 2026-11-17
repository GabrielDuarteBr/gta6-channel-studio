import { createHash } from 'node:crypto';
import {
  audit,
  getAllSettings,
  getPrisma,
  type PartnerStage,
  type PermissionStatus,
  type Prisma,
  type ProofKind,
} from '@studio/db';
import {
  assertDailyLimit,
  assertPartnerPermission,
  assertPermissionInput,
  parseShareLink,
  PolicyViolation,
  type PartnerConditions,
  type PermissionState,
} from '@studio/policy';
import { PRODUCTION_JOB } from '@studio/production';
import {
  createQueue,
  deterministicJobId,
  HUNT_JOB,
  PARTNER_IMPORT_JOB,
  redisConnection,
  type QueueName,
} from '@studio/queue';
import { parseEnv, redisEnvSchema } from '@studio/shared';
import { objectStore } from './library';
import { startedToday } from './production';

/**
 * Parceiros no painel (Fase 4): candidatos do Caçador, permissões (tipo, prova, condições,
 * status), arquivos e o botão "Produzir Short de react". O sistema nunca envia mensagens: o
 * rascunho é para o dono copiar.
 */

async function enqueue(queueName: QueueName, name: string, data: unknown, jobId: string) {
  const { REDIS_URL } = parseEnv(redisEnvSchema);
  const queue = createQueue(queueName, redisConnection(REDIS_URL));
  try {
    await queue.add(name, data, { jobId, attempts: queueName === 'media' ? 3 : 2 });
  } finally {
    await queue.close();
  }
}

const minute = () => new Date().toISOString().slice(0, 16);

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

export async function listPartners() {
  const prisma = getPrisma();
  const partners = await prisma.partner.findMany({
    include: {
      permissions: { orderBy: { createdAt: 'desc' } },
      imports: { orderBy: { createdAt: 'desc' }, take: 8 },
      assets: {
        where: { kind: 'VIDEO' },
        include: { manifest: true },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      _count: { select: { productions: true } },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 80,
  });
  const order: Record<PartnerStage, number> = {
    PARTNER: 0,
    CONTACTED: 1,
    CANDIDATE: 2,
    DISMISSED: 3,
  };
  return partners.sort((a, b) => order[a.stage] - order[b.stage]);
}

export async function lastHunt() {
  return getPrisma().jobRun.findFirst({
    where: { queue: 'research', name: HUNT_JOB },
    orderBy: { createdAt: 'desc' },
  });
}

/** Caçador agora (pelo botão) ou um canal colado pelo dono. */
export async function requestHunt(channelUrl?: string): Promise<void> {
  const data = channelUrl ? { channelUrl } : {};
  const key = channelUrl
    ? createHash('sha256').update(channelUrl).digest('hex').slice(0, 16)
    : 'busca';
  await enqueue(
    'research',
    HUNT_JOB,
    data,
    deterministicJobId('research', HUNT_JOB, key, minute()),
  );
  await audit(getPrisma(), {
    actor: 'owner',
    action: 'partners.hunt.request',
    target: channelUrl ?? 'youtube',
  });
}

export async function setStage(partnerId: string, stage: PartnerStage): Promise<void> {
  const prisma = getPrisma();
  await prisma.partner.update({ where: { id: partnerId }, data: { stage } });
  await audit(prisma, {
    actor: 'owner',
    action: 'partner.stage',
    target: partnerId,
    details: { stage },
  });
}

export interface PermissionForm {
  partnerId: string;
  proofKind: ProofKind;
  proof: string;
  proofFile?: { bytes: Uint8Array; type: string } | null;
  grantedAt: Date;
  expiresAt: Date | null;
  conditions: PartnerConditions;
  explicitConfirmation: boolean;
}

const PROOF_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

/** Registra a permissão (regra 2). Lança PolicyViolation se faltar algo. */
export async function registerPermission(input: PermissionForm): Promise<string> {
  const prisma = getPrisma();
  assertPermissionInput({
    type: 'REACT_CLIPS',
    proofKind: input.proofKind,
    proof: input.proof,
    hasProofFile: Boolean(input.proofFile),
    grantedAt: input.grantedAt,
    expiresAt: input.expiresAt,
    conditions: input.conditions,
    explicitConfirmation: input.explicitConfirmation,
  });
  let proofFileKey: string | null = null;
  if (input.proofFile) {
    const ext = PROOF_TYPES[input.proofFile.type];
    if (!ext)
      throw new PolicyViolation('PARTNER_PERMISSION_ACTIVE', 'Print em PNG, JPG, WEBP ou PDF.');
    if (input.proofFile.bytes.byteLength > 10 * 1024 * 1024) {
      throw new PolicyViolation('PARTNER_PERMISSION_ACTIVE', 'Print com no máximo 10 MB.');
    }
    const sha = createHash('sha256').update(input.proofFile.bytes).digest('hex');
    proofFileKey = `partners/proofs/${sha}.${ext}`;
    await objectStore().put(proofFileKey, input.proofFile.bytes, input.proofFile.type);
  }
  const conditions = {
    credit: input.conditions.credit.trim(),
    link: input.conditions.link?.trim() || null,
    hashtag: input.conditions.hashtag?.trim() || null,
    monetization: input.conditions.monetization,
    maxClipSec: input.conditions.maxClipSec ?? null,
    notes: input.conditions.notes?.trim() || null,
  };
  const perm = await prisma.partnerPermission.create({
    data: {
      partnerId: input.partnerId,
      type: 'REACT_CLIPS',
      proofKind: input.proofKind,
      proof: input.proof.trim(),
      proofFileKey,
      grantedAt: input.grantedAt,
      expiresAt: input.expiresAt,
      conditions: conditions as Prisma.InputJsonValue,
      createdBy: 'owner',
    },
  });
  await prisma.partner.update({ where: { id: input.partnerId }, data: { stage: 'PARTNER' } });
  await audit(prisma, {
    actor: 'owner',
    action: 'partner.permission.add',
    target: perm.id,
    details: { partnerId: input.partnerId, proofKind: input.proofKind, conditions },
  });
  return perm.id;
}

export interface AffectedProduction {
  id: string;
  title: string | null;
  status: string;
}

/** Vídeos que usaram arquivos desta permissão (para o dono decidir o que fazer). */
export async function affectedProductions(permissionId: string): Promise<AffectedProduction[]> {
  const rows = await getPrisma().productionAsset.findMany({
    where: { asset: { manifest: { permissionId } } },
    include: { production: { select: { id: true, title: true, status: true } } },
  });
  return [...new Map(rows.map((r) => [r.production.id, r.production])).values()];
}

/**
 * Suspende, reativa ou revoga. Revogar tira os direitos dos arquivos (o render recusa) e
 * devolve a lista de vídeos afetados.
 */
export async function setPermissionStatus(
  permissionId: string,
  status: PermissionStatus,
  reason: string,
): Promise<AffectedProduction[]> {
  const prisma = getPrisma();
  const perm = await prisma.partnerPermission.findUniqueOrThrow({ where: { id: permissionId } });
  if (perm.status === 'REVOKED') {
    throw new PolicyViolation(
      'PARTNER_PERMISSION_ACTIVE',
      'Permissão revogada não volta: registre uma nova.',
    );
  }
  await prisma.partnerPermission.update({
    where: { id: permissionId },
    data:
      status === 'REVOKED'
        ? {
            status,
            revokedAt: new Date(),
            revokedReason: reason.slice(0, 500) || 'revogada pelo dono',
          }
        : { status },
  });
  if (status === 'REVOKED') {
    await prisma.rightsManifest.updateMany({
      where: { permissionId },
      data: {
        status: 'REVOKED',
        revokedAt: new Date(),
        revokedReason: `permissão revogada: ${reason}`.slice(0, 500),
      },
    });
  }
  const affected = await affectedProductions(permissionId);
  await audit(prisma, {
    actor: 'owner',
    action: `partner.permission.${status.toLowerCase()}`,
    target: permissionId,
    details: { reason, affected: affected.map((a) => a.id) },
  });
  return affected;
}

async function activePermission(partnerId: string, permissionId: string) {
  const perm = await getPrisma().partnerPermission.findUniqueOrThrow({
    where: { id: permissionId },
  });
  if (perm.partnerId !== partnerId) {
    throw new PolicyViolation('PARTNER_PERMISSION_ACTIVE', 'A permissão é de outro parceiro.');
  }
  assertPartnerPermission(permissionState(perm), 'REACT_CLIPS');
  return perm;
}

/** Importa por link do Dropbox/Drive (o YouTube é recusado aqui e de novo no agents). */
export async function importFromLink(input: {
  partnerId: string;
  permissionId: string;
  url: string;
  title: string | null;
}): Promise<string> {
  await activePermission(input.partnerId, input.permissionId);
  const link = parseShareLink(input.url);
  const prisma = getPrisma();
  const imp = await prisma.partnerImport.create({
    data: {
      partnerId: input.partnerId,
      permissionId: input.permissionId,
      source: link.provider,
      url: input.url.trim(),
      title: input.title,
      createdBy: 'owner',
    },
  });
  await enqueue(
    'media',
    PARTNER_IMPORT_JOB,
    { importId: imp.id },
    deterministicJobId('media', PARTNER_IMPORT_JOB, imp.id),
  );
  await audit(prisma, {
    actor: 'owner',
    action: 'partner.import.request',
    target: imp.id,
    details: { provider: link.provider, folder: link.folder },
  });
  return imp.id;
}

/** Envio pelo painel: o arquivo já está no S3 (incoming/...); o agents confere e processa. */
export async function importFromUpload(input: {
  partnerId: string;
  permissionId: string;
  incomingKey: string;
  originalName: string;
  title: string | null;
}): Promise<string> {
  await activePermission(input.partnerId, input.permissionId);
  const prisma = getPrisma();
  const imp = await prisma.partnerImport.create({
    data: {
      partnerId: input.partnerId,
      permissionId: input.permissionId,
      source: 'upload',
      incomingKey: input.incomingKey,
      originalName: input.originalName.slice(0, 200),
      title: input.title,
      createdBy: 'owner',
    },
  });
  await enqueue(
    'media',
    PARTNER_IMPORT_JOB,
    { importId: imp.id },
    deterministicJobId('media', PARTNER_IMPORT_JOB, imp.id),
  );
  await audit(prisma, {
    actor: 'owner',
    action: 'partner.import.request',
    target: imp.id,
    details: { provider: 'upload' },
  });
  return imp.id;
}

/** O dono ouviu o arquivo e confirma que não há música/filme/TV de terceiros (áudio inteiro). */
export async function setAudioCleared(assetId: string, cleared: boolean): Promise<void> {
  const prisma = getPrisma();
  await prisma.asset.update({ where: { id: assetId }, data: { audioCleared: cleared } });
  await audit(prisma, {
    actor: 'owner',
    action: 'partner.asset.audio',
    target: assetId,
    details: { cleared },
  });
}

/** "Produzir Short de react": confere permissão e limite diário, cria a produção e enfileira. */
export async function startReact(assetId: string): Promise<string> {
  const prisma = getPrisma();
  const settings = await getAllSettings(prisma);
  const asset = await prisma.asset.findUniqueOrThrow({
    where: { id: assetId },
    include: { manifest: { include: { permission: true } } },
  });
  if (asset.kind !== 'VIDEO' || asset.origin !== 'PARTNER' || !asset.partnerId) {
    throw new PolicyViolation(
      'PARTNER_PERMISSION_ACTIVE',
      'Só vídeos de parceiros viram Short de react.',
    );
  }
  const perm = asset.manifest?.permission;
  assertPartnerPermission(perm ? permissionState(perm) : null, 'REACT_CLIPS');
  if (asset.manifest?.status !== 'ACTIVE') {
    throw new PolicyViolation(
      'ASSET_REQUIRES_MANIFEST',
      'Os direitos deste arquivo foram revogados.',
    );
  }
  if (asset.analysisStatus !== 'READY') {
    throw new Error('A análise do vídeo ainda não terminou (transcrição e trechos de fala).');
  }
  assertDailyLimit('SHORT', await startedToday('SHORT'), settings['limits.daily']);
  const prod = await prisma.production.create({
    data: {
      kind: 'REACT',
      format: 'SHORT',
      partnerId: asset.partnerId,
      sourceAssetId: asset.id,
      status: 'QUEUED',
      step: 'na fila',
      title: `React: ${asset.title}`.slice(0, 100),
      createdBy: 'owner',
    },
  });
  await enqueue(
    'render',
    PRODUCTION_JOB,
    { productionId: prod.id },
    deterministicJobId('render', PRODUCTION_JOB, prod.id, minute()),
  );
  await audit(prisma, {
    actor: 'owner',
    action: 'production.start',
    target: prod.id,
    details: { kind: 'REACT', assetId, partnerId: asset.partnerId },
  });
  return prod.id;
}

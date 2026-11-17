import {
  audit,
  getAllSettings,
  getPrisma,
  Prisma,
  youtubeConnection,
  type ProductionFormat,
} from '@studio/db';
import { PolicyViolation, type ComplianceReport } from '@studio/policy';
import {
  CHAT_JOB,
  COMPLIANCE_JOB,
  createQueue,
  DAILY_JOB,
  deterministicJobId,
  METRICS_JOB,
  redisConnection,
  UPLOAD_JOB,
  type QueueName,
} from '@studio/queue';
import { channelDay, nextPublishSlot, parseEnv, redisEnvSchema } from '@studio/shared';
import { z } from 'zod';

/**
 * Aprovação, publicação, calendário e Comando no painel (Fases 5–7). Nada fica público sem o
 * dono: aprovar cria a Publicação, que sobe PRIVADA e agendada (ou vira pacote manual quando o
 * YouTube não está conectado). O agents confere tudo de novo no banco antes de enviar.
 */

const minute = () => new Date().toISOString().slice(0, 16);

async function enqueue(
  queueName: QueueName,
  name: string,
  data: unknown,
  jobId: string,
  extra: { attempts?: number; backoff?: { type: 'exponential'; delay: number } } = {},
) {
  const { REDIS_URL } = parseEnv(redisEnvSchema);
  const queue = createQueue(queueName, redisConnection(REDIS_URL));
  try {
    await queue.add(name, data, { jobId, attempts: extra.attempts ?? 2, ...extra });
  } finally {
    await queue.close();
  }
}

export const enqueueCompliance = (productionId: string) =>
  enqueue(
    'llm',
    COMPLIANCE_JOB,
    { productionId },
    deterministicJobId('llm', COMPLIANCE_JOB, productionId, new Date().toISOString()),
  );

export const enqueueUpload = (publicationId: string) =>
  enqueue(
    'upload',
    UPLOAD_JOB,
    { publicationId },
    deterministicJobId('upload', UPLOAD_JOB, publicationId, new Date().toISOString()),
    { attempts: 8, backoff: { type: 'exponential', delay: 60_000 } },
  );

export interface ProductionMetadata {
  title: string;
  description: string;
  tags: string[];
  editedByOwner?: boolean;
}

export const metadataSchema = z.object({
  title: z.string().trim().min(3).max(100),
  description: z.string().trim().min(10).max(5000),
  tags: z.array(z.string().trim().min(1).max(60)).max(30),
});

/** YouTube conectado E credenciais do OAuth no .env? */
export async function youtubeReady() {
  const conn = await youtubeConnection(getPrisma());
  const hasClient = Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET,
  );
  return { conn, hasClient, connected: hasClient && conn?.status === 'ok' };
}

/** Vídeos prontos esperando o dono (sem publicação, ou com a anterior cancelada/falha). */
export async function approvalQueue() {
  return getPrisma().production.findMany({
    where: {
      status: 'READY',
      OR: [{ publication: null }, { publication: { status: { in: ['CANCELED', 'FAILED'] } } }],
    },
    include: {
      publication: true,
      partner: { select: { name: true } },
      story: { select: { isRumor: true } },
    },
    orderBy: { finishedAt: 'desc' },
    take: 20,
  });
}

export async function listPublications(opts: { from?: Date; to?: Date; take?: number } = {}) {
  return getPrisma().publication.findMany({
    where: {
      ...(opts.from || opts.to
        ? {
            publishAt: {
              ...(opts.from ? { gte: opts.from } : {}),
              ...(opts.to ? { lte: opts.to } : {}),
            },
          }
        : {}),
    },
    include: {
      production: {
        select: {
          id: true,
          kind: true,
          format: true,
          outputs: true,
          partner: { select: { name: true } },
        },
      },
    },
    orderBy: { publishAt: 'asc' },
    take: opts.take ?? 200,
  });
}

/** Horário sugerido: o próximo livre das Configurações. */
export async function suggestedSlot(now = new Date()): Promise<Date> {
  const prisma = getPrisma();
  const settings = await getAllSettings(prisma);
  const taken = await prisma.publication.findMany({
    where: { status: { in: ['QUEUED', 'UPLOADING', 'SCHEDULED', 'MANUAL'] } },
    select: { publishAt: true },
  });
  return nextPublishSlot(
    now,
    settings.youtube.publishTimes,
    taken.map((t) => t.publishAt),
  );
}

/** Limite diário também na publicação (por dia de Brasília da data marcada). */
async function assertPublishLimit(format: ProductionFormat, publishAt: Date, ignoreId?: string) {
  const prisma = getPrisma();
  const limits = (await getAllSettings(prisma))['limits.daily'];
  const sameDay = await prisma.publication.findMany({
    where: {
      status: { in: ['QUEUED', 'UPLOADING', 'SCHEDULED', 'MANUAL', 'PUBLISHED'] },
      publishAt: {
        gte: new Date(publishAt.getTime() - 36 * 3_600_000),
        lte: new Date(publishAt.getTime() + 36 * 3_600_000),
      },
      production: { format },
      ...(ignoreId ? { NOT: { id: ignoreId } } : {}),
    },
    select: { publishAt: true },
  });
  const count = sameDay.filter((p) => channelDay(p.publishAt) === channelDay(publishAt)).length;
  const max = format === 'LONG' ? limits.long : limits.shorts;
  if (count >= max) {
    throw new PolicyViolation(
      'DAILY_LIMITS',
      `Já há ${count} ${format === 'LONG' ? 'longo(s)' : 'Short(s)'} marcados para ${channelDay(publishAt)} (limite ${max}). Escolha outro dia.`,
    );
  }
}

/**
 * Aprovar: cria (ou refaz) a Publicação. Com o YouTube conectado (ou no modo simulado), entra
 * na fila de envio; sem conexão, vira pacote manual para o YouTube Studio.
 */
export async function approvePublication(
  input: { productionId: string; publishAt: Date },
  actor = 'owner',
  now = new Date(),
): Promise<{ id: string; mode: 'api' | 'manual'; simulated: boolean }> {
  const prisma = getPrisma();
  const settings = await getAllSettings(prisma);
  const prod = await prisma.production.findUniqueOrThrow({
    where: { id: input.productionId },
    include: { publication: true },
  });
  if (prod.status !== 'READY') throw new Error('O vídeo não está pronto.');
  if (prod.publication && !['CANCELED', 'FAILED'].includes(prod.publication.status)) {
    throw new Error('Este vídeo já foi aprovado.');
  }
  const report = prod.compliance as ComplianceReport | null;
  if (!report) throw new Error('A Conformidade ainda está conferindo este vídeo. Aguarde.');
  if (!report.ok) {
    throw new PolicyViolation(
      'HUMAN_APPROVAL',
      'A Conformidade reprovou: corrija antes de aprovar.',
    );
  }
  const meta = prod.metadata as ProductionMetadata | null;
  if (!meta) throw new Error('Sem título e descrição: rode a Conformidade de novo.');
  if (input.publishAt.getTime() < now.getTime() + 30 * 60_000) {
    throw new Error('Escolha um horário pelo menos 30 minutos no futuro.');
  }
  await assertPublishLimit(prod.format, input.publishAt, prod.publication?.id);

  const { connected } = await youtubeReady();
  const simulated = settings['mode.simulation'];
  const mode: 'api' | 'manual' = connected || simulated ? 'api' : 'manual';
  const data = {
    status: mode === 'api' ? ('QUEUED' as const) : ('MANUAL' as const),
    mode,
    title: meta.title,
    description: meta.description,
    tags: meta.tags,
    categoryId: settings.youtube.categoryId,
    publishAt: input.publishAt,
    syntheticMedia: true,
    simulated,
    approvedBy: actor,
    approvedAt: now,
    youtubeVideoId: null,
    uploadUri: null,
    uploadedBytes: 0,
    thumbnailSet: false,
    step: mode === 'manual' ? 'pacote pronto: envie pelo YouTube Studio' : 'na fila de envio',
    error: null,
    publishedAt: null,
  };
  const pub = await prisma.publication.upsert({
    where: { productionId: prod.id },
    create: { productionId: prod.id, ...data },
    update: data,
  });
  await audit(prisma, {
    actor,
    action: 'publish.approve',
    target: pub.id,
    details: { productionId: prod.id, mode, simulated, publishAt: input.publishAt.toISOString() },
  });
  if (mode === 'api') await enqueueUpload(pub.id);
  return { id: pub.id, mode, simulated };
}

/** O dono editou título/descrição/tags: a Conformidade confere de novo. */
export async function saveMetadata(productionId: string, meta: z.infer<typeof metadataSchema>) {
  const prisma = getPrisma();
  const value: ProductionMetadata = { ...meta, editedByOwner: true };
  await prisma.production.update({
    where: { id: productionId },
    data: { metadata: value as unknown as Prisma.InputJsonValue, compliance: Prisma.DbNull },
  });
  await audit(prisma, { actor: 'owner', action: 'publish.metadata', target: productionId });
  await enqueueCompliance(productionId);
}

export async function recheckCompliance(productionId: string) {
  await audit(getPrisma(), { actor: 'owner', action: 'publish.recheck', target: productionId });
  await enqueueCompliance(productionId);
}

export async function rejectProduction(productionId: string, reason: string) {
  const prisma = getPrisma();
  await prisma.production.update({
    where: { id: productionId },
    data: {
      status: 'CANCELED',
      step: `rejeitado na Aprovação${reason ? `: ${reason.slice(0, 200)}` : ''}`,
      finishedAt: new Date(),
    },
  });
  await audit(prisma, {
    actor: 'owner',
    action: 'publish.reject',
    target: productionId,
    details: { reason: reason.slice(0, 500) },
  });
}

/** Cancela antes do envio (QUEUED/MANUAL/FAILED). Vídeo já enviado: apague no YouTube Studio. */
export async function cancelPublication(publicationId: string) {
  const prisma = getPrisma();
  const pub = await prisma.publication.findUniqueOrThrow({ where: { id: publicationId } });
  if (!['QUEUED', 'MANUAL', 'FAILED'].includes(pub.status)) {
    throw new Error(
      'Este vídeo já foi enviado ao YouTube: para desistir, apague-o no YouTube Studio.',
    );
  }
  await prisma.publication.update({
    where: { id: pub.id },
    data: { status: 'CANCELED', step: 'cancelado pelo dono' },
  });
  await audit(prisma, { actor: 'owner', action: 'publish.cancel', target: pub.id });
}

/** Envio que falhou (ou travou) volta para a fila; data vencida pede outra. */
export async function retryUpload(publicationId: string, publishAt?: Date) {
  const prisma = getPrisma();
  const pub = await prisma.publication.findUniqueOrThrow({
    where: { id: publicationId },
    include: { production: { select: { format: true } } },
  });
  if (pub.status !== 'FAILED') return;
  const when = publishAt ?? pub.publishAt;
  if (when.getTime() < Date.now() + 30 * 60_000) {
    throw new Error('A data marcada já passou: aprove de novo escolhendo outro horário.');
  }
  await prisma.publication.update({
    where: { id: pub.id },
    data: { status: 'QUEUED', publishAt: when, error: null, step: 'na fila de envio' },
  });
  await audit(prisma, { actor: 'owner', action: 'publish.retry', target: pub.id });
  await enqueueUpload(pub.id);
}

/** Id do vídeo a partir do link do YouTube colado pelo dono (envio manual). */
export function parseYouTubeVideoId(url: string): string | null {
  const s = url.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return /^\/([A-Za-z0-9_-]{11})/.exec(u.pathname)?.[1] ?? null;
    if (host === 'youtube.com' || host === 'studio.youtube.com') {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      return /\/(?:shorts|video|embed|live)\/([A-Za-z0-9_-]{11})/.exec(u.pathname)?.[1] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

/** O dono enviou pelo YouTube Studio (pacote manual) e cola o link: as métricas passam a contar. */
export async function markManualUploaded(publicationId: string, url: string) {
  const prisma = getPrisma();
  const videoId = parseYouTubeVideoId(url);
  if (!videoId) throw new Error('Link do YouTube inválido.');
  const pub = await prisma.publication.findUniqueOrThrow({ where: { id: publicationId } });
  if (pub.status !== 'MANUAL') return;
  const published = pub.publishAt.getTime() <= Date.now();
  await prisma.publication.update({
    where: { id: pub.id },
    data: {
      youtubeVideoId: videoId,
      status: published ? 'PUBLISHED' : 'SCHEDULED',
      publishedAt: published ? pub.publishAt : null,
      step: 'enviado pelo YouTube Studio',
    },
  });
  await audit(prisma, {
    actor: 'owner',
    action: 'publish.manual',
    target: pub.id,
    details: { youtubeVideoId: videoId },
  });
}

/** Texto do pacote manual (título, descrição, tags e lembretes do YouTube Studio). */
export function manualPackageText(pub: {
  title: string;
  description: string;
  tags: string[];
  publishAt: Date;
}) {
  const when = pub.publishAt.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    dateStyle: 'full',
    timeStyle: 'short',
  });
  return [
    'PACOTE PARA O YOUTUBE STUDIO — Radar Neon',
    '',
    'TÍTULO',
    pub.title,
    '',
    'DESCRIÇÃO',
    pub.description,
    '',
    'TAGS (separadas por vírgula)',
    pub.tags.join(', '),
    '',
    'NO YOUTUBE STUDIO',
    `• Visibilidade: Privado → Programar para ${when} (horário de Brasília).`,
    '• Público: "Não é conteúdo para crianças".',
    '• Detalhes → "Conteúdo alterado ou sintético": marque SIM (voz e apresentador gerados por IA).',
    '• Thumbnail: use o arquivo thumbnail.png do pacote (só vídeos longos).',
    '• Depois de enviar, cole o link do vídeo na Aprovação para as métricas contarem.',
    '',
  ].join('\n');
}

/* ---------- Comando (chat) ---------- */

export async function sendChat(text: string) {
  const prisma = getPrisma();
  const busy = await prisma.chatMessage.findFirst({
    where: {
      role: 'assistant',
      state: 'escrevendo',
      createdAt: { gte: new Date(Date.now() - 10 * 60_000) },
    },
  });
  if (busy) throw new Error('O Diretor ainda está respondendo. Aguarde.');
  await prisma.chatMessage.create({ data: { role: 'user', text: text.slice(0, 4000) } });
  const assistant = await prisma.chatMessage.create({
    data: { role: 'assistant', text: '', state: 'escrevendo' },
  });
  await enqueue('llm', CHAT_JOB, { assistantMessageId: assistant.id }, `chat.${assistant.id}`, {
    attempts: 1,
  });
  return assistant.id;
}

export async function chatHistory(take = 60) {
  const rows = await getPrisma().chatMessage.findMany({ orderBy: { createdAt: 'desc' }, take });
  return rows.reverse();
}

export async function pendingActions() {
  const prisma = getPrisma();
  const cutoff = new Date(Date.now() - 24 * 3_600_000);
  await prisma.pendingAction.updateMany({
    where: { status: 'PENDING', createdAt: { lt: cutoff } },
    data: { status: 'EXPIRED', decidedAt: new Date() },
  });
  return prisma.pendingAction.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
}

/** O dono confirma (ou recusa) um pedido do Diretor. Só aqui a ação no canal acontece. */
export async function decidePendingAction(id: string, confirm: boolean) {
  const prisma = getPrisma();
  const action = await prisma.pendingAction.findUniqueOrThrow({ where: { id } });
  if (action.status !== 'PENDING') return action.status;
  if (action.createdAt.getTime() < Date.now() - 24 * 3_600_000) {
    await prisma.pendingAction.update({
      where: { id },
      data: { status: 'EXPIRED', decidedAt: new Date() },
    });
    return 'EXPIRED';
  }
  let result = 'recusado pelo dono';
  if (confirm) {
    if (action.kind !== 'publish.approve') throw new Error(`pedido desconhecido: ${action.kind}`);
    const params = z
      .object({ productionId: z.string(), publishAt: z.string().datetime() })
      .parse(action.params);
    try {
      const pub = await approvePublication(
        { productionId: params.productionId, publishAt: new Date(params.publishAt) },
        'owner',
      );
      result =
        pub.mode === 'manual'
          ? 'aprovado: pacote manual pronto na Aprovação'
          : pub.simulated
            ? 'aprovado: envio simulado na fila'
            : 'aprovado: na fila de envio (privado e agendado)';
    } catch (err) {
      result = `não deu: ${(err as Error).message.replace(/^\[[A-Z_]+\]\s*/, '')}`;
      await prisma.pendingAction.update({
        where: { id },
        data: { status: 'REJECTED', result, decidedAt: new Date() },
      });
      return 'REJECTED';
    }
  }
  await prisma.pendingAction.update({
    where: { id },
    data: { status: confirm ? 'CONFIRMED' : 'REJECTED', result, decidedAt: new Date() },
  });
  await audit(prisma, {
    actor: 'owner',
    action: confirm ? 'command.confirm' : 'command.reject',
    target: id,
    details: { kind: action.kind, result },
  });
  return confirm ? 'CONFIRMED' : 'REJECTED';
}

/* ---------- Botões de agenda ---------- */

export async function runDailyNow() {
  await audit(getPrisma(), { actor: 'owner', action: 'pauta.daily.request' });
  await enqueue(
    'system',
    DAILY_JOB,
    { force: true },
    deterministicJobId('system', DAILY_JOB, 'agora', minute()),
    {
      attempts: 1,
    },
  );
}

export async function syncMetricsNow() {
  await audit(getPrisma(), { actor: 'owner', action: 'metrics.sync.request' });
  await enqueue(
    'system',
    METRICS_JOB,
    {},
    deterministicJobId('system', METRICS_JOB, 'agora', minute()),
    {
      attempts: 1,
    },
  );
}

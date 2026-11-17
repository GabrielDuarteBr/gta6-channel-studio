/**
 * Aceite da etapa final (Fases 5–7), pelo mesmo caminho do painel e das filas:
 *   docker compose exec agents node_modules/.bin/tsx src/scripts/publish.ts <passo>
 *   --fluxo       vídeo pronto → Conformidade → aprovação → envio SIMULADO (sempre simulado aqui)
 *   --bloqueio    Conformidade reprovada: o envio é recusado (3ª camada); limpa o teste
 *   --comando     pergunta ao Diretor "Como está a pauta hoje?" e espera a resposta
 *   --diaria      roda a produção diária agora (só com o modo simulado ligado: não gasta)
 *   --youtube     confere a conexão com o canal (só leitura) e sincroniza as métricas
 *   --enviar      com --youtube: ENVIO REAL de teste, PRIVADO e agendado para daqui a 30 dias
 * A última linha é um JSON.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { audit, getAllSettings, getPrisma, Prisma, youtubeConnection } from '@studio/db';
import { PolicyViolation, type ComplianceReport } from '@studio/policy';
import {
  CHAT_JOB,
  COMPLIANCE_JOB,
  createQueue,
  DAILY_JOB,
  deterministicJobId,
  redisConnection,
  UPLOAD_JOB,
} from '@studio/queue';
import {
  createLogger,
  encryptionEnvSchema,
  nextPublishSlot,
  parseEnv,
  redisEnvSchema,
} from '@studio/shared';
import { WORK_ROOT } from '../partners/download';
import { runMetricsSync } from '../publish/metrics';
import { runUpload } from '../publish/upload';
import { youtubePublisher } from '../publish/youtube';

const flag = (name: string) => process.argv.includes(`--${name}`);
const env = parseEnv(redisEnvSchema.merge(encryptionEnvSchema));
const prisma = getPrisma();
const connection = redisConnection(env.REDIS_URL);
const log = createLogger('aceite', 'warn');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const minute = () => new Date().toISOString().slice(0, 16);
const publisher = () =>
  youtubePublisher(prisma, {
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || undefined,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || undefined,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
  });
let code = 0;

async function readyProduction() {
  return prisma.production.findFirst({
    where: { status: 'READY', publication: null },
    orderBy: { finishedAt: 'desc' },
  });
}

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms: number): Promise<T | null> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const v = await fn();
    if (v) return v;
    await sleep(2000);
  }
  return null;
}

async function fluxo() {
  const prod = await readyProduction();
  if (!prod) return { error: 'nenhum vídeo pronto sem publicação (rode make produzir antes)' };
  const llm = createQueue('llm', connection);
  const upload = createQueue('upload', connection);
  try {
    // A Conformidade roda sozinha quando o vídeo fica pronto; pede de novo por garantia.
    if (!prod.compliance) {
      await llm.add(
        COMPLIANCE_JOB,
        { productionId: prod.id },
        {
          jobId: deterministicJobId('llm', COMPLIANCE_JOB, prod.id, new Date().toISOString()),
          attempts: 2,
        },
      );
    }
    const done = await waitFor(
      () =>
        prisma.production.findFirst({
          where: { id: prod.id, compliance: { not: Prisma.DbNull } },
        }),
      180_000,
    );
    if (!done) return { error: 'a Conformidade não respondeu em 3 minutos' };
    const report = done.compliance as unknown as ComplianceReport;
    const meta = done.metadata as { title: string; description: string; tags: string[] };
    const result = {
      id: prod.id,
      title: meta.title,
      complianceOk: report.ok,
      failed: report.checks.filter((c) => !c.ok).map((c) => `${c.id}: ${c.message}`),
      hasSources: meta.description.includes('Fontes:'),
      hasAiNotice: /voz sintética \(IA\)/.test(meta.description),
      status: '',
      publishAt: '',
    };
    if (!report.ok) return result;
    const settings = await getAllSettings(prisma);
    const taken = await prisma.publication.findMany({
      where: { status: { in: ['QUEUED', 'UPLOADING', 'SCHEDULED', 'MANUAL'] } },
      select: { publishAt: true },
    });
    const pub = await prisma.publication.create({
      data: {
        productionId: prod.id,
        mode: 'api',
        status: 'QUEUED',
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        categoryId: settings.youtube.categoryId,
        publishAt: nextPublishSlot(
          new Date(),
          settings.youtube.publishTimes,
          taken.map((t) => t.publishAt),
        ),
        simulated: true, // aceite: nunca sai do computador
        approvedBy: 'owner:aceite',
      },
    });
    await audit(prisma, {
      actor: 'owner:aceite',
      action: 'publish.approve',
      target: pub.id,
      details: { productionId: prod.id, simulated: true },
    });
    await upload.add(
      UPLOAD_JOB,
      { publicationId: pub.id },
      { jobId: deterministicJobId('upload', UPLOAD_JOB, pub.id, minute()), attempts: 3 },
    );
    const final = await waitFor(
      () =>
        prisma.publication.findFirst({
          where: { id: pub.id, status: { in: ['SCHEDULED', 'FAILED', 'MANUAL'] } },
        }),
      120_000,
    );
    result.status = final?.status ?? 'sem resposta';
    result.publishAt = pub.publishAt.toISOString();
    return result;
  } finally {
    await llm.close();
    await upload.close();
  }
}

/** Produção de teste com Conformidade reprovada: o envio tem de ser recusado no banco. */
async function bloqueio() {
  const prod = await prisma.production.create({
    data: {
      kind: 'NEWS',
      format: 'SHORT',
      status: 'READY',
      title: 'Teste de bloqueio (aceite)',
      createdBy: 'owner:aceite',
      outputs: { video: 'aceite/bloqueio.mp4' },
      compliance: {
        ok: false,
        checks: [{ id: 'fatos', ok: false, severity: 'block', message: 'afirmação sem fonte' }],
        checkedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });
  await mkdir(path.join(WORK_ROOT, 'aceite'), { recursive: true });
  await writeFile(path.join(WORK_ROOT, 'aceite', 'bloqueio.mp4'), Buffer.alloc(16));
  const pub = await prisma.publication.create({
    data: {
      productionId: prod.id,
      mode: 'api',
      status: 'QUEUED',
      title: 'teste',
      description: 'teste',
      tags: [],
      publishAt: new Date(Date.now() + 3 * 3_600_000),
      simulated: true,
      approvedBy: 'owner:aceite',
    },
  });
  let refused = false;
  let error = '';
  try {
    await runUpload(
      {
        prisma,
        log,
        publisher: async () => {
          throw new Error('não deveria chegar ao YouTube');
        },
      },
      pub.id,
    );
  } catch (err) {
    refused = err instanceof PolicyViolation;
    error = (err as Error).message;
  }
  const status = (await prisma.publication.findUniqueOrThrow({ where: { id: pub.id } })).status;
  await prisma.production.update({
    where: { id: prod.id },
    data: { status: 'CANCELED', step: 'teste de bloqueio do aceite' },
  });
  await prisma.publication.update({ where: { id: pub.id }, data: { status: 'CANCELED' } });
  return { refused, status, error };
}

async function comando() {
  const llm = createQueue('llm', connection);
  try {
    await prisma.chatMessage.create({ data: { role: 'user', text: 'Como está a pauta hoje?' } });
    const a = await prisma.chatMessage.create({ data: { role: 'assistant', state: 'escrevendo' } });
    await llm.add(CHAT_JOB, { assistantMessageId: a.id }, { jobId: `chat.${a.id}`, attempts: 1 });
    const done = await waitFor(
      () => prisma.chatMessage.findFirst({ where: { id: a.id, state: { not: 'escrevendo' } } }),
      120_000,
    );
    const tools = ((done?.tool ?? []) as Array<{ name: string }>).map((t) => t.name);
    return { state: done?.state ?? 'sem resposta', tools, text: (done?.text ?? '').slice(0, 300) };
  } finally {
    await llm.close();
  }
}

async function diaria() {
  const settings = await getAllSettings(prisma);
  if (!settings['mode.simulation']) {
    return { skipped: 'modo simulado desligado: rodar agora gastaria. Use o botão no painel.' };
  }
  const system = createQueue('system', connection);
  const since = new Date();
  try {
    await system.add(
      DAILY_JOB,
      { force: true },
      { jobId: deterministicJobId('system', DAILY_JOB, 'aceite', minute()), attempts: 1 },
    );
    const entry = await waitFor(
      () => prisma.auditLog.findFirst({ where: { action: 'pauta.daily', at: { gte: since } } }),
      60_000,
    );
    const created = ((entry?.details as { created?: unknown[] } | null)?.created ?? []).length;
    return { ran: Boolean(entry), created, time: settings['schedule.daily'].time };
  } finally {
    await system.close();
  }
}

async function youtube() {
  const conn = await youtubeConnection(prisma);
  if (!process.env.GOOGLE_OAUTH_CLIENT_ID) return { skipped: 'sem cliente OAuth no .env' };
  if (conn?.status !== 'ok') return { skipped: 'YouTube não conectado (Configurações → YouTube)' };
  const yt = await publisher();
  const channel = await yt.myChannel();
  let metrics: unknown;
  try {
    metrics = await runMetricsSync({ prisma, log, publisher });
  } catch (err) {
    metrics = { error: (err as Error).message.slice(0, 200) };
  }
  const out: Record<string, unknown> = { channel: channel.title, metrics };
  if (flag('enviar')) {
    // Envio real de teste: PRIVADO, agendado para daqui a 30 dias às 12:00 (Brasília).
    const prod = await readyProduction();
    const report = prod?.compliance as ComplianceReport | null;
    if (!prod || !report?.ok) {
      out.upload = { error: 'sem vídeo pronto aprovado pela Conformidade' };
    } else {
      const meta = prod.metadata as { title: string; description: string; tags: string[] };
      const day = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const pub = await prisma.publication.create({
        data: {
          productionId: prod.id,
          mode: 'api',
          status: 'QUEUED',
          title: `[TESTE] ${meta.title}`.slice(0, 100),
          description: meta.description,
          tags: meta.tags,
          publishAt: new Date(`${day}T12:00:00-03:00`),
          simulated: false,
          approvedBy: 'owner:aceite',
        },
      });
      await audit(prisma, {
        actor: 'owner:aceite',
        action: 'publish.approve',
        target: pub.id,
        details: { productionId: prod.id, test: true },
      });
      const upload = createQueue('upload', connection);
      await upload.add(
        UPLOAD_JOB,
        { publicationId: pub.id },
        { jobId: deterministicJobId('upload', UPLOAD_JOB, pub.id, minute()), attempts: 3 },
      );
      await upload.close();
      const final = await waitFor(
        () =>
          prisma.publication.findFirst({
            where: { id: pub.id, status: { in: ['SCHEDULED', 'FAILED'] } },
          }),
        20 * 60_000,
      );
      out.upload = {
        status: final?.status ?? 'sem resposta',
        videoId: final?.youtubeVideoId,
        publishAt: pub.publishAt.toISOString(),
        error: final?.error,
      };
    }
  }
  return out;
}

try {
  if (flag('fluxo')) console.log(JSON.stringify({ fluxo: await fluxo() }));
  else if (flag('bloqueio')) console.log(JSON.stringify({ bloqueio: await bloqueio() }));
  else if (flag('comando')) console.log(JSON.stringify({ comando: await comando() }));
  else if (flag('diaria')) console.log(JSON.stringify({ diaria: await diaria() }));
  else if (flag('youtube')) console.log(JSON.stringify({ youtube: await youtube() }));
  else {
    console.error('Use --fluxo, --bloqueio, --comando, --diaria ou --youtube [--enviar].');
    code = 2;
  }
} catch (err) {
  console.error((err as Error).message);
  console.log(JSON.stringify({ error: (err as Error).message.slice(0, 300) }));
  code = 1;
} finally {
  await prisma.$disconnect();
}
process.exit(code);

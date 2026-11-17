import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPrisma, ensureBible, setSetting, type PrismaClient } from '@studio/db';
import { Llm } from '@studio/llm';
import { PolicyViolation, type ComplianceReport } from '@studio/policy';
import { AI_NOTICE } from '@studio/production';
import { FakeImageProvider, type YouTubePublisher } from '@studio/providers';
import { createLogger } from '@studio/shared';
import { MemoryObjectStore } from '@studio/storage';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runChatTurn } from '../src/command/chat';
import { runProduction, type ProductionContext } from '../src/production/pipeline';
import { runCompliance } from '../src/publish/compliance';
import { settleSimulated } from '../src/publish/metrics';
import { runUpload } from '../src/publish/upload';
import { dailyDue, ranToday, runDailyProduction } from '../src/schedule/daily';
import { fakeServices, tts } from './helpers/production-fakes';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

d('Conformidade, aprovação, envio, produção diária e Comando', () => {
  const prisma: PrismaClient = createPrisma(url as string);
  const log = createLogger('teste', 'silent');
  const budget = async () => ({
    spentTodayUsd: 0,
    spentMonthUsd: 0,
    dailyLimitUsd: 5,
    monthlyLimitUsd: 50,
  });
  const llm = new Llm({ simulation: true, budget, record: async () => {} });
  let work: string;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Asset", "RightsManifest", "Production", "ProductionAsset", "Story", "NewsItem", "Source", "CostLedger", "AuditLog", "Setting", "Publication", "ChatMessage", "PendingAction", "ChannelStat", "VideoStat" CASCADE',
    );
    await ensureBible(prisma);
    work = await mkdtemp(path.join(os.tmpdir(), 'pub-'));
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seedStory(title = 'Rockstar confirma data do trailer', isRumor = false) {
    const src =
      (await prisma.source.findFirst({ where: { name: 'Rockstar Newswire' } })) ??
      (await prisma.source.create({
        data: {
          name: 'Rockstar Newswire',
          kind: 'RSS',
          tier: 'OFFICIAL',
          url: 'https://www.rockstargames.com/newswire',
        },
      }));
    const press =
      (await prisma.source.findFirst({ where: { name: 'IGN' } })) ??
      (await prisma.source.create({
        data: { name: 'IGN', kind: 'RSS', tier: 'PRESS', url: 'https://www.ign.com/rss' },
      }));
    const n = Math.random().toString(36).slice(2, 8);
    const story = await prisma.story.create({
      data: {
        title: `${title} ${n}`,
        titlePt: `${title} ${n}`,
        isRumor,
        independentSources: 2,
        officialCount: 1,
        itemCount: 2,
        score: isRumor ? 0.3 : 0.9,
        lastSeenAt: new Date(),
      },
    });
    for (const [s, u] of [
      [src, `https://www.rockstargames.com/newswire/article/${n}`],
      [press, `https://www.ign.com/articles/${n}`],
    ] as const) {
      await prisma.newsItem.create({
        data: {
          sourceId: s.id,
          url: u,
          domain: new URL(u).hostname.replace(/^www\./, ''),
          title,
          normalizedTitle: title.toLowerCase(),
          storyId: story.id,
        },
      });
    }
    return story;
  }

  async function readyProduction(format: 'LONG' | 'SHORT' = 'LONG') {
    const story = await seedStory();
    const prod = await prisma.production.create({
      data: { storyId: story.id, format, status: 'QUEUED', createdBy: 'owner' },
    });
    const ready: string[] = [];
    const ctx: ProductionContext = {
      prisma,
      log,
      store: new MemoryObjectStore(),
      mediaUrl: 'http://media',
      renderUrl: 'http://render',
      renderHeight: 720,
      images: new FakeImageProvider(),
      tts,
      llm,
      onReady: async (id) => {
        ready.push(id);
      },
      ...fakeServices(),
    };
    const r = await runProduction(ctx, prod.id);
    expect(r.status).toBe('READY');
    expect(ready).toEqual([prod.id]);
    // arquivo do vídeo na pasta de trabalho (o envio lê o tamanho dele)
    const video = path.join(work, 'productions', prod.id, 'r1', 'video.mp4');
    await mkdir(path.dirname(video), { recursive: true });
    await writeFile(video, Buffer.alloc(1024, 1));
    await writeFile(path.join(path.dirname(video), 'thumb-1.png'), Buffer.alloc(64, 2));
    return prod.id;
  }

  it('vídeo pronto → Conformidade monta descrição com fontes e aviso de IA e aprova', async () => {
    const id = await readyProduction();
    const report = await runCompliance({ prisma, log, llm }, id);
    expect(report.ok).toBe(true);
    const prod = await prisma.production.findUniqueOrThrow({ where: { id } });
    const meta = prod.metadata as { title: string; description: string; tags: string[] };
    expect(meta.title.length).toBeLessThanOrEqual(100);
    expect(meta.description).toContain('Fontes:');
    expect(meta.description).toMatch(/• Rockstar Newswire: https:\/\/www\.rockstargames\.com/);
    expect(meta.description).toContain(AI_NOTICE);
    expect(
      (prod.compliance as unknown as ComplianceReport).checks.find((c) => c.id === 'ia')?.ok,
    ).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { action: 'publish.compliance' } });
    expect(audit?.outcome).toBe('OK');
  });

  it('aprovado no modo simulado: "envio" agendado sem sair do computador e publicado na hora', async () => {
    const id = await readyProduction();
    await runCompliance({ prisma, log, llm }, id);
    const prod = await prisma.production.findUniqueOrThrow({ where: { id } });
    const meta = prod.metadata as { title: string; description: string; tags: string[] };
    const publishAt = new Date(Date.now() + 3 * 3_600_000);
    const pub = await prisma.publication.create({
      data: {
        productionId: id,
        mode: 'api',
        status: 'QUEUED',
        title: meta.title,
        description: meta.description,
        tags: meta.tags,
        publishAt,
        simulated: true,
        approvedBy: 'owner',
      },
    });
    const publisher = async (): Promise<YouTubePublisher> => {
      throw new Error('não deveria chamar o YouTube no modo simulado');
    };
    const r = await runUpload({ prisma, log, publisher, workRoot: work }, pub.id);
    expect(r).toMatchObject({ status: 'SCHEDULED', simulated: true });
    expect(await settleSimulated(prisma, new Date(publishAt.getTime() + 1000))).toBe(1);
    const done = await prisma.publication.findUniqueOrThrow({ where: { id: pub.id } });
    expect(done.status).toBe('PUBLISHED');
    expect(done.syntheticMedia).toBe(true);
  });

  it('envio real (YouTube falso): privado+agendado, sessão salva e thumbnail do longo', async () => {
    const id = await readyProduction();
    await runCompliance({ prisma, log, llm }, id);
    const pub = await prisma.publication.create({
      data: {
        productionId: id,
        mode: 'api',
        status: 'QUEUED',
        title: 'Título',
        description: 'Descrição com fontes',
        tags: ['GTA 6'],
        publishAt: new Date(Date.now() + 5 * 3_600_000),
        simulated: false,
        approvedBy: 'owner',
      },
    });
    const calls: string[] = [];
    let started: { publishAt: Date } | null = null;
    const fake = {
      startUpload: async (meta: { publishAt: Date }) => {
        calls.push('start');
        started = meta;
        return 'https://upload.example/sessao-1';
      },
      uploadStatus: async () => ({ next: 0 }),
      uploadFile: async (
        _uri: string,
        _p: string,
        _from: number,
        onProgress: (p: { uploadedBytes: number; totalBytes: number }) => Promise<void>,
      ) => {
        calls.push('upload');
        await onProgress({ uploadedBytes: 1024, totalBytes: 1024 });
        return 'abcdefghijk';
      },
      setThumbnail: async () => {
        calls.push('thumb');
      },
    } as unknown as YouTubePublisher;
    const r = await runUpload({ prisma, log, publisher: async () => fake, workRoot: work }, pub.id);
    expect(r).toMatchObject({ status: 'SCHEDULED', youtubeVideoId: 'abcdefghijk' });
    expect(calls).toEqual(['start', 'upload', 'thumb']);
    expect(started!.publishAt.getTime()).toBe(pub.publishAt.getTime());
    const saved = await prisma.publication.findUniqueOrThrow({ where: { id: pub.id } });
    expect(saved).toMatchObject({ thumbnailSet: true, uploadUri: null, uploadedBytes: 1024 });
  });

  it('Conformidade reprovada (ou direito revogado) impede o envio — 3ª camada', async () => {
    const id = await readyProduction();
    await runCompliance({ prisma, log, llm }, id);
    await prisma.production.update({
      where: { id },
      data: { compliance: { ok: false, checks: [], checkedAt: new Date().toISOString() } },
    });
    const pub = await prisma.publication.create({
      data: {
        productionId: id,
        mode: 'api',
        status: 'QUEUED',
        title: 't',
        description: 'd',
        tags: [],
        publishAt: new Date(Date.now() + 3_600_000),
        simulated: true,
        approvedBy: 'owner',
      },
    });
    await expect(
      runUpload(
        { prisma, log, publisher: async () => ({}) as YouTubePublisher, workRoot: work },
        pub.id,
      ),
    ).rejects.toBeInstanceOf(PolicyViolation);
    expect((await prisma.publication.findUniqueOrThrow({ where: { id: pub.id } })).status).toBe(
      'FAILED',
    );

    // direito da imagem revogado depois da Conformidade: recusa também
    await runCompliance({ prisma, log, llm }, id);
    await prisma.rightsManifest.updateMany({ data: { status: 'REVOKED' } });
    await prisma.publication.update({ where: { id: pub.id }, data: { status: 'QUEUED' } });
    await expect(
      runUpload(
        { prisma, log, publisher: async () => ({}) as YouTubePublisher, workRoot: work },
        pub.id,
      ),
    ).rejects.toBeInstanceOf(PolicyViolation);
  });

  it('piloto automático desligado: Conformidade ok NÃO agenda; ligado: agenda sozinho', async () => {
    const id = await readyProduction();
    const queued: string[] = [];
    const enqueueUpload = async (p: string) => {
      queued.push(p);
    };
    await runCompliance({ prisma, log, llm, enqueueUpload }, id);
    expect(queued).toHaveLength(0);
    expect(await prisma.publication.count()).toBe(0);
    await setSetting(prisma, 'mode.autopilot', true, 'owner');
    await runCompliance({ prisma, log, llm, enqueueUpload }, id);
    expect(queued).toHaveLength(1);
    const pub = await prisma.publication.findFirstOrThrow();
    expect(pub).toMatchObject({ approvedBy: 'agent:piloto-automatico', status: 'QUEUED' });
    expect(pub.publishAt.getTime()).toBeGreaterThan(Date.now() + 60 * 60_000);
  });

  it('produção diária: melhores histórias permitidas até o limite, uma vez por dia', async () => {
    await seedStory('Trailer 3 confirmado');
    await seedStory('Preço revelado');
    await seedStory('Mapa vazado', true); // rumor com fontes, mas nota baixa
    const leak = await seedStory('Build vazada');
    await prisma.story.update({
      where: { id: leak.id },
      data: { flags: { leak: true }, score: 2 },
    });
    await setSetting(
      prisma,
      'schedule.daily',
      {
        enabled: true,
        time: '07:41',
        long: 1,
        newsShorts: 1,
        reacts: 1,
      },
      'owner',
    );
    const enq: string[] = [];
    const r = await runDailyProduction({
      prisma,
      log,
      enqueueProduction: async (p) => {
        enq.push(p);
      },
    });
    expect(r.created.map((c) => c.format)).toEqual(['LONG', 'SHORT']);
    expect(enq).toHaveLength(2);
    const prods = await prisma.production.findMany({ include: { story: true } });
    expect(prods.every((p) => !p.story?.title.startsWith('Build vazada'))).toBe(true);
    expect(await ranToday(prisma)).toBe(true);
    expect(
      (await runDailyProduction({ prisma, log, enqueueProduction: async () => {} })).skipped,
    ).toBe('já rodou hoje');
    expect(dailyDue(new Date('2026-11-18T10:40:00Z'), '07:41')).toBe(false);
    expect(dailyDue(new Date('2026-11-18T10:41:00Z'), '07:41')).toBe(true);
  });

  it('Comando (simulado): "faça um Short" põe na fila; publicar só vira pedido para o dono', async () => {
    await seedStory('Trailer 3 confirmado');
    const enq: string[] = [];
    const ctx = {
      prisma,
      log,
      llm,
      enqueueProduction: async (p: string) => {
        enq.push(p);
      },
      enqueueHunt: async () => {},
    };
    await prisma.chatMessage.create({
      data: { role: 'user', text: 'Faça um Short da melhor notícia' },
    });
    const a = await prisma.chatMessage.create({ data: { role: 'assistant', state: 'escrevendo' } });
    await runChatTurn(ctx, a.id);
    const reply = await prisma.chatMessage.findUniqueOrThrow({ where: { id: a.id } });
    expect(reply.state).toBe('pronto');
    expect((reply.tool as Array<{ name: string }>).map((t) => t.name)).toEqual([
      'ver_pauta',
      'produzir_noticia',
    ]);
    expect(enq).toHaveLength(1);
    expect((await prisma.production.findUniqueOrThrow({ where: { id: enq[0] } })).format).toBe(
      'SHORT',
    );

    // publicar: vídeo pronto e aprovado pela Conformidade → só um PEDIDO
    const id = await readyProduction();
    await runCompliance({ prisma, log, llm }, id);
    await prisma.chatMessage.create({
      data: { role: 'user', text: 'Pode publicar o vídeo pronto' },
    });
    const b = await prisma.chatMessage.create({ data: { role: 'assistant', state: 'escrevendo' } });
    await runChatTurn(ctx, b.id);
    const action = await prisma.pendingAction.findFirstOrThrow();
    expect(action).toMatchObject({ kind: 'publish.approve', status: 'PENDING' });
    expect(await prisma.publication.count()).toBe(0);
  });

  afterAll(async () => {
    if (work) await rm(work, { recursive: true, force: true });
  });
});

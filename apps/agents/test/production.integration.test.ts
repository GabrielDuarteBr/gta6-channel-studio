import { createPrisma, ensureBible, setSetting } from '@studio/db';
import { Llm } from '@studio/llm';
import { FakeImageProvider, ProviderError, type TtsProvider } from '@studio/providers';
import { UnrecoverableError } from '@studio/queue';
import { createLogger } from '@studio/shared';
import { MemoryObjectStore } from '@studio/storage';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaService, RenderService, type FetchLike } from '../src/character/services';
import { runProductionJob } from '../src/production/job';
import { runProduction, type ProductionContext } from '../src/production/pipeline';
import { fakeWriterOutput } from '../src/production/writer';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const tts: TtsProvider = {
  id: 'fake',
  label: 'teste',
  real: false,
  synthesize: async (req) => ({
    path: req.out,
    durationSec: 1,
    chars: req.text.length,
    costUsd: 0,
    provider: 'fake',
  }),
};

/** worker-media e render falsos: respondem como os de verdade e guardam os pedidos. */
function fakeServices() {
  const renders: Array<{ composition: string; output: string; props: Record<string, unknown> }> =
    [];
  const files = new Set<string>();
  const fetchImpl: FetchLike = async (u, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const path = new URL(u).pathname;
    const reply = (data: unknown) => new Response(JSON.stringify(data));
    switch (path) {
      case '/audio/voice-track': {
        const n = body.segments.length;
        const segments = Array.from({ length: n }, (_, i) => ({
          start: 0.2 + i * 1.3,
          end: 1.2 + i * 1.3,
        }));
        return reply({ path: body.out, duration_sec: segments.at(-1)!.end + 0.3, segments });
      }
      case '/lipsync':
        return reply({ duration_sec: 3, mouth_cues: [{ start: 0.2, end: 0.6, value: 'D' }] });
      case '/file/info':
        return reply(files.has(body.path) ? { exists: true, bytes: 10 } : { exists: false });
      case '/image/import':
        files.add(body.out);
        return reply({ path: body.out, bytes: 10 });
      case '/video/keyframes':
        return reply({ frames: body.times.map((t: number) => ({ t, jpeg_b64: 'AAAA' })) });
      case '/image/preview':
        return reply({ jpeg_b64: 'BBBB' });
      case '/render': {
        renders.push(body);
        return reply({
          id: `r${renders.length}`,
          status: 'pronto',
          report: {
            output: body.output,
            width: body.still ? 1280 : 1280,
            height: 720,
            frames: body.still ? 1 : 300,
            seconds: body.still ? 1.1 : 25.4,
            bytes: 1234,
            cpuSeconds: body.still ? 0.8 : 60.2,
            peakMemoryMb: 900,
            metricsSource: 'cgroup',
          },
        });
      }
      default:
        return new Response('{}', { status: 404 });
    }
  };
  return {
    renders,
    files,
    media: new MediaService('http://media', fetchImpl),
    render: new RenderService('http://render', fetchImpl, async () => {}),
  };
}

d('produção de vídeo de notícia (pipeline)', () => {
  const prisma = createPrisma(url as string);
  const log = createLogger('teste', 'silent');
  const budget = async () => ({
    spentTodayUsd: 0,
    spentMonthUsd: 0,
    dailyLimitUsd: 5,
    monthlyLimitUsd: 50,
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Asset", "RightsManifest", "Production", "ProductionAsset", "Story", "NewsItem", "Source", "CostLedger", "AuditLog", "Setting" CASCADE',
    );
    await ensureBible(prisma);
  });
  afterAll(() => prisma.$disconnect());

  async function seedStory(isRumor = false) {
    const src = await prisma.source.create({
      data: {
        name: 'Rockstar Newswire',
        kind: 'RSS',
        tier: 'OFFICIAL',
        url: 'https://www.rockstargames.com/newswire',
      },
    });
    const press = await prisma.source.create({
      data: { name: 'IGN', kind: 'RSS', tier: 'PRESS', url: 'https://www.ign.com/rss' },
    });
    const story = await prisma.story.create({
      data: {
        title: 'Rockstar confirms trailer date',
        titlePt: 'Rockstar confirma data do trailer',
        isRumor,
        independentSources: 2,
        officialCount: 1,
        status: 'QUEUED_LONG',
      },
    });
    await prisma.newsItem.create({
      data: {
        sourceId: src.id,
        url: 'https://www.rockstargames.com/newswire/article/1',
        domain: 'rockstargames.com',
        title: 'Trailer date',
        normalizedTitle: 'trailer date',
        storyId: story.id,
      },
    });
    await prisma.newsItem.create({
      data: {
        sourceId: press.id,
        url: 'https://www.ign.com/articles/trailer',
        domain: 'ign.com',
        title: 'Rockstar sets trailer date',
        normalizedTitle: 'rockstar sets trailer date',
        storyId: story.id,
      },
    });
    return story;
  }

  function ctxWith(
    over: Partial<ProductionContext> = {},
  ): ProductionContext & ReturnType<typeof fakeServices> {
    const svc = fakeServices();
    return {
      prisma,
      log,
      store: new MemoryObjectStore(),
      mediaUrl: 'http://media',
      renderUrl: 'http://render',
      renderHeight: 720,
      images: new FakeImageProvider(),
      tts,
      llm: new Llm({ simulation: true, budget, record: async () => {} }),
      ...svc,
      ...over,
    };
  }

  it('modo simulado: roteiro → imagens → voz → vídeo + 3 thumbnails → Revisor aprova', async () => {
    const story = await seedStory();
    const prod = await prisma.production.create({
      data: { storyId: story.id, format: 'LONG', status: 'QUEUED', createdBy: 'owner' },
    });
    const ctx = ctxWith();
    const r = await runProduction(ctx, prod.id);
    expect(r).toMatchObject({ status: 'READY', rounds: 1 });
    expect(ctx.renders.map((x) => x.composition)).toEqual([
      'NewsVideo',
      'Thumbnail',
      'Thumbnail',
      'Thumbnail',
    ]);
    expect(ctx.renders[0]!.output).toBe(`productions/${prod.id}/r1/video.mp4`);
    const saved = await prisma.production.findUniqueOrThrow({ where: { id: prod.id } });
    expect(saved.title).toMatch(/Rockstar confirma/);
    expect(saved.outputs).toMatchObject({
      video: `productions/${prod.id}/r1/video.mp4`,
      thumbnail: `productions/${prod.id}/r1/thumb-1.png`,
    });
    // imagem gerada entrou na Biblioteca com manifesto e foi ligada ao vídeo
    const usages = await prisma.productionAsset.findMany({
      where: { productionId: prod.id },
      include: { asset: { include: { manifest: true } } },
    });
    expect(usages.length).toBeGreaterThanOrEqual(1);
    expect(usages[0]!.asset.manifest).toMatchObject({ origin: 'IMAGE_PROVIDER', status: 'ACTIVE' });
    expect(ctx.files.size).toBe(usages.length);
    // relatório de render com CPU e memória; custo por vídeo registrado (simulado = 0)
    expect(saved.renderReport).toEqual([
      expect.objectContaining({ round: 1, video: expect.objectContaining({ cpuSeconds: 60.2 }) }),
    ]);
    const ledger = await prisma.costLedger.findMany({ where: { productionId: prod.id } });
    expect(ledger.map((l) => l.provider).sort()).toContain('image');
    // de novo: já pronto, não faz nada
    expect((await runProduction(ctx, prod.id)).status).toBe('READY');
    expect(ctx.renders).toHaveLength(4);
  });

  it('Revisor reprova a imagem de uma cena → nova imagem e 2ª volta aprovada', async () => {
    const story = await seedStory();
    await setSetting(prisma, 'mode.simulation', false, 'owner');
    const prod = await prisma.production.create({
      data: { storyId: story.id, format: 'LONG', status: 'QUEUED', createdBy: 'owner' },
    });
    const writer = fakeWriterOutput({
      story: {
        id: story.id,
        title: story.title,
        titlePt: story.titlePt,
        summaryPt: null,
        kind: null,
        isRumor: false,
        sources: [],
        library: [],
      },
      format: 'LONG',
      targetSec: 10,
      maxGeneratedImages: 6,
      bible: undefined as never,
      model: 'claude-sonnet-5-5',
      spoilerWindow: { launchDate: '2026-11-19', windowDays: 30 },
      productionId: prod.id,
    });
    const items = await prisma.newsItem.findMany({
      where: { storyId: story.id },
      orderBy: { domain: 'desc' },
    });
    writer.lines[1]!.sourceIds = [items.find((i) => i.domain === 'rockstargames.com')!.id];
    // frase de opinião longa para passar na duração mínima (alvo 210 s × 0,45)
    const extra = 'Isso muda bastante coisa para quem espera o jogo. '.repeat(10).trim();
    for (let i = 0; i < 5; i++) {
      writer.lines.push({
        id: 5 + i,
        scene: 3,
        kind: 'opiniao',
        text: `[serio] ${extra}`,
        sourceIds: [],
      });
    }
    const ok = (data: unknown) => ({
      model: 'claude-sonnet-5-5',
      stop_reason: 'end_turn',
      parsed_output: data,
      usage: { input_tokens: 1000, output_tokens: 200 },
    });
    const parse = vi
      .fn()
      .mockResolvedValueOnce(ok(writer))
      .mockResolvedValueOnce(
        ok({
          summary: 'A imagem da cena 2 tem texto deformado.',
          issues: [
            {
              target: 'quadro',
              index: 2,
              kind: 'imagem_com_texto',
              severity: 'media',
              detail: 'letras tortas',
              fix: 'trocar_imagem',
            },
          ],
          bestThumbnail: 2,
        }),
      )
      .mockResolvedValueOnce(ok({ summary: 'Tudo certo.', issues: [], bestThumbnail: 2 }));
    const llm = new Llm({
      simulation: false,
      client: { messages: { parse: vi.fn() }, beta: { messages: { parse } } } as never,
      budget,
      record: async () => {},
    });
    const ctx = ctxWith({ llm });
    const r = await runProduction(ctx, prod.id);
    expect(r).toMatchObject({ status: 'READY', rounds: 2 });
    const saved = await prisma.production.findUniqueOrThrow({ where: { id: prod.id } });
    const reviews = saved.review as Array<{ approved: boolean; replaceScenes: number[] }>;
    expect(reviews.map((x) => x.approved)).toEqual([false, true]);
    expect(reviews[0]!.replaceScenes.length).toBe(1);
    const prompts = await prisma.rightsManifest.findMany({ select: { prompt: true } });
    expect(prompts.some((p) => /alternative composition 2/.test(p.prompt ?? ''))).toBe(true);
    expect(saved.outputs).toMatchObject({ thumbnail: `productions/${prod.id}/r2/thumb-2.png` });
    // o 3º pedido (revisão da volta 2) recebeu os quadros como imagens
    const reviewCall = parse.mock.calls[2]![0];
    expect(reviewCall.messages[0].content.some((b: { type: string }) => b.type === 'image')).toBe(
      true,
    );
  });

  it('direito revogado entre as imagens e o render: o render é recusado (3ª camada)', async () => {
    const story = await seedStory();
    const prod = await prisma.production.create({
      data: { storyId: story.id, format: 'SHORT', status: 'QUEUED', createdBy: 'owner' },
    });
    const ctx = ctxWith();
    // 1ª passada até as imagens: simula queda logo depois da etapa de arte
    const origRender = ctx.render!.render.bind(ctx.render);
    ctx.render!.render = async () => {
      throw new Error('container caiu');
    };
    await expect(runProduction(ctx, prod.id)).rejects.toThrow('container caiu');
    const used = await prisma.productionAsset.findFirstOrThrow({
      where: { productionId: prod.id },
    });
    await prisma.rightsManifest.update({
      where: { assetId: used.assetId },
      data: { status: 'REVOKED' },
    });
    ctx.render!.render = origRender;
    await expect(runProductionJob(ctx, { productionId: prod.id })).rejects.toThrow(
      UnrecoverableError,
    );
    const saved = await prisma.production.findUniqueOrThrow({ where: { id: prod.id } });
    expect(saved.status).toBe('FAILED');
    expect(saved.error).toMatch(/revogados/);
  });

  it('sem chave da voz do Google (modo real): falha de vez com o que configurar', async () => {
    const story = await seedStory();
    await setSetting(prisma, 'mode.simulation', false, 'owner');
    const prod = await prisma.production.create({
      data: { storyId: story.id, format: 'SHORT', status: 'QUEUED', createdBy: 'owner' },
    });
    const ctx = ctxWith({
      tts: {
        ...tts,
        synthesize: async () => {
          throw new ProviderError('voz do Google sem chave: configure GOOGLE_TTS_API_KEY no .env');
        },
      },
    });
    await expect(
      runProductionJob(ctx, { productionId: prod.id }, { made: 0, max: 2 }),
    ).rejects.toThrow(UnrecoverableError);
    const saved = await prisma.production.findUniqueOrThrow({ where: { id: prod.id } });
    expect(saved).toMatchObject({ status: 'FAILED' });
    expect(saved.error).toMatch(/GOOGLE_TTS_API_KEY/);
  });
});

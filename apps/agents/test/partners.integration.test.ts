import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createPrisma, ensureBible, setSetting, type PrismaClient } from '@studio/db';
import { PolicyViolation } from '@studio/policy';
import type { TtsProvider } from '@studio/providers';
import { UnrecoverableError } from '@studio/queue';
import { createLogger } from '@studio/shared';
import { MemoryObjectStore } from '@studio/storage';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MediaService, RenderService, type FetchLike } from '../src/character/services';
import { runHunt } from '../src/partners/hunter';
import { runPartnerImport, type PartnerContext } from '../src/partners/import';
import { runProductionJob } from '../src/production/job';
import type { ProductionContext } from '../src/production/pipeline';
import { runReactProduction } from '../src/react/pipeline';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;
const log = createLogger('teste');

/** "Vídeo" mínimo: os primeiros bytes de um MP4 (ftyp) — o tipo é conferido pelos bytes. */
const FAKE_MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from('ftypisom'),
  Buffer.alloc(200, 7),
]);

const conditions = {
  credit: 'Canal do Fulano',
  link: 'https://www.youtube.com/@fulano',
  hashtag: '#fulanogames',
  monetization: 'allowed',
  maxClipSec: null,
};

async function seedPartner(prisma: PrismaClient, status: 'ACTIVE' | 'REVOKED' = 'ACTIVE') {
  const partner = await prisma.partner.create({
    data: {
      name: 'Fulano Games',
      channelUrl: 'https://www.youtube.com/@fulano',
      stage: 'PARTNER',
      discoveredBy: 'owner',
    },
  });
  const permission = await prisma.partnerPermission.create({
    data: {
      partnerId: partner.id,
      type: 'REACT_CLIPS',
      proofKind: 'EMAIL',
      proof: 'E-mail de 10/11/2026: autorizo o Radar Neon a usar cortes em Shorts de react.',
      grantedAt: new Date('2026-11-10T12:00:00Z'),
      conditions,
      status,
      createdBy: 'owner',
    },
  });
  return { partner, permission };
}

/** worker-media e render falsos (respondem como os de verdade). */
function fakeServices() {
  const renders: Array<Record<string, unknown>> = [];
  const cuts: Array<Record<string, unknown>> = [];
  const fetchImpl: FetchLike = async (u, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const p = new URL(u).pathname;
    const reply = (data: unknown) => new Response(JSON.stringify(data));
    switch (p) {
      case '/video/probe':
        return reply({
          path: body.video,
          duration_sec: 40,
          width: 1280,
          height: 720,
          fps: 30,
          video_codec: 'h264',
          has_audio: true,
          audio_codec: 'aac',
          bytes: 1000,
        });
      case '/video/keyframes':
        return reply({ frames: body.times.map((t: number) => ({ t, jpeg_b64: 'AAAA' })) });
      case '/video/cut':
        cuts.push(body);
        return reply({
          path: body.out,
          duration_sec: Math.round((body.end - body.start) * 1000) / 1000,
          width: 1280,
          height: 720,
          audio_mode: body.audio_mode,
          speech_ranges: [],
        });
      case '/audio/voice-track': {
        // 2 s por trecho de voz, com as pausas pedidas (o clipe entra nas pausas).
        let cursor = body.lead_in_ms / 1000;
        const segments = body.segments.map((s: { pause_after_ms: number }) => {
          const seg = { start: cursor, end: cursor + 2 };
          cursor = seg.end + s.pause_after_ms / 1000;
          return seg;
        });
        return reply({ path: body.out, duration_sec: cursor + body.tail_ms / 1000, segments });
      }
      case '/lipsync':
        return reply({ duration_sec: 3, mouth_cues: [{ start: 0.3, end: 0.8, value: 'D' }] });
      case '/render':
        renders.push(body);
        return reply({
          id: `r${renders.length}`,
          status: 'pronto',
          report: {
            output: body.output,
            width: 720,
            height: 1280,
            frames: 900,
            seconds: 20,
            bytes: 9,
          },
        });
      default:
        return new Response('{}', { status: 404 });
    }
  };
  return {
    renders,
    cuts,
    media: new MediaService('http://media', fetchImpl),
    render: new RenderService('http://render', fetchImpl, async () => {}),
  };
}

const tts: TtsProvider = {
  id: 'fake',
  label: 'teste',
  real: false,
  synthesize: async (req) => ({
    path: req.out,
    durationSec: 2,
    chars: req.text.length,
    costUsd: 0,
    provider: 'fake',
  }),
};

d('parceiros: importação, Caçador e Short de react', () => {
  const prisma = createPrisma(url as string);
  let workRoot: string;
  let store: MemoryObjectStore;
  let analyzed: string[];

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "Partner", "PartnerPermission", "PartnerImport", "Asset", "RightsManifest", "Production", "ProductionAsset", "AuditLog", "Setting", "CostLedger", "QuotaLedger", "CharacterBible" CASCADE',
    );
    await ensureBible(prisma);
    workRoot = await mkdtemp(path.join(os.tmpdir(), 'radar-work-'));
    store = new MemoryObjectStore();
    analyzed = [];
  });
  afterEach(async () => rm(workRoot, { recursive: true, force: true }));
  afterAll(() => prisma.$disconnect());

  const partnerCtx = (fetchImpl: FetchLike, media: MediaService, driveKey?: string) =>
    ({
      prisma,
      log,
      store,
      media,
      driveKey,
      fetchImpl,
      workRoot,
      enqueueAnalysis: async (id: string) => {
        analyzed.push(id);
      },
    }) satisfies PartnerContext;

  it('link do Dropbox: segue o redirecionamento, guarda na Biblioteca com manifesto e pede a análise', async () => {
    const { partner, permission } = await seedPartner(prisma);
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (u) => {
      seen.push(u);
      if (u.startsWith('https://www.dropbox.com/')) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://uc1.dl.dropboxusercontent.com/cd/0/get/abc/file' },
        });
      }
      return new Response(FAKE_MP4, {
        headers: {
          'content-type': 'video/mp4',
          'content-disposition': `attachment; filename="perseguicao.mp4"`,
          'content-length': String(FAKE_MP4.length),
        },
      });
    };
    const imp = await prisma.partnerImport.create({
      data: {
        partnerId: partner.id,
        permissionId: permission.id,
        source: 'dropbox',
        url: 'https://www.dropbox.com/scl/fi/abc/perseguicao.mp4?rlkey=k&dl=0',
        createdBy: 'owner',
      },
    });
    const r = await runPartnerImport(partnerCtx(fetchImpl, fakeServices().media), imp.id);
    expect(r.status).toBe('DONE');
    expect(seen[0]).toBe('https://www.dropbox.com/scl/fi/abc/perseguicao.mp4?rlkey=k&dl=1');
    const asset = await prisma.asset.findUniqueOrThrow({
      where: { id: r.assets[0]! },
      include: { manifest: true },
    });
    expect(asset).toMatchObject({
      kind: 'VIDEO',
      origin: 'PARTNER',
      partnerId: partner.id,
      durationSec: 40,
      analysisStatus: 'PENDING',
      originalName: 'perseguicao.mp4',
    });
    expect(asset.manifest).toMatchObject({
      permissionId: permission.id,
      credit: 'Canal do Fulano',
    });
    expect(store.objects.has(asset.storageKey)).toBe(true);
    expect(analyzed).toEqual([asset.id]);
    const local = path.join(workRoot, 'partners', `${asset.sha256}.mp4`);
    expect((await readFile(local)).equals(FAKE_MP4)).toBe(true);
    // A pasta temporária da importação foi limpa.
    await expect(stat(path.join(workRoot, 'imports', imp.id))).rejects.toThrow();
  });

  it('bloqueia: permissão revogada, link do YouTube e redirecionamento para fora do Dropbox', async () => {
    const revoked = await seedPartner(prisma, 'REVOKED');
    const ok = async () => new Response(FAKE_MP4);
    const mk = (partnerId: string, permissionId: string, link: string) =>
      prisma.partnerImport.create({
        data: { partnerId, permissionId, source: 'dropbox', url: link, createdBy: 'owner' },
      });
    const a = await mk(
      revoked.partner.id,
      revoked.permission.id,
      'https://www.dropbox.com/s/x/a.mp4',
    );
    await expect(runPartnerImport(partnerCtx(ok, fakeServices().media), a.id)).rejects.toThrow(
      /revogada/,
    );
    expect((await prisma.partnerImport.findUniqueOrThrow({ where: { id: a.id } })).status).toBe(
      'FAILED',
    );

    const { partner, permission } = await seedPartner(prisma);
    const b = await mk(partner.id, permission.id, 'https://www.youtube.com/watch?v=abc');
    await expect(runPartnerImport(partnerCtx(ok, fakeServices().media), b.id)).rejects.toThrow(
      /YouTube/,
    );
    const evil: FetchLike = async () =>
      new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/segredo' } });
    const c = await mk(partner.id, permission.id, 'https://www.dropbox.com/s/x/c.mp4');
    await expect(runPartnerImport(partnerCtx(evil, fakeServices().media), c.id)).rejects.toThrow(
      PolicyViolation,
    );
    expect(await prisma.asset.count()).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { action: 'partner.import', outcome: 'DENIED' } }),
    ).toBe(3);
  });

  it('Google Drive: chave no cabeçalho (nunca na URL) e mensagem clara se a Drive API estiver desligada', async () => {
    const { partner, permission } = await seedPartner(prisma);
    const calls: Array<{ url: string; key: string | null }> = [];
    const drive: FetchLike = async (u, init) => {
      const key = new Headers(init?.headers).get('x-goog-api-key');
      calls.push({ url: u, key });
      if (u.includes('alt=media')) return new Response(FAKE_MP4);
      return new Response(
        JSON.stringify({
          id: '1AbCdEfGhIjKlMnOp',
          name: 'corte.mp4',
          mimeType: 'video/mp4',
          size: '220',
        }),
      );
    };
    const imp = await prisma.partnerImport.create({
      data: {
        partnerId: partner.id,
        permissionId: permission.id,
        source: 'gdrive',
        url: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing',
        createdBy: 'owner',
      },
    });
    const r = await runPartnerImport(partnerCtx(drive, fakeServices().media, 'AIzaTESTE'), imp.id);
    expect(r.assets).toHaveLength(1);
    expect(calls.every((c) => c.key === 'AIzaTESTE' && !c.url.includes('AIza'))).toBe(true);

    const disabled: FetchLike = async () =>
      new Response(
        JSON.stringify({
          error: {
            code: 403,
            message: 'Drive API has not been used',
            errors: [{ reason: 'accessNotConfigured' }],
          },
        }),
        { status: 403 },
      );
    const imp2 = await prisma.partnerImport.create({
      data: {
        partnerId: partner.id,
        permissionId: permission.id,
        source: 'gdrive',
        url: 'https://drive.google.com/file/d/1ZzZzZzZzZzZzZz/view',
        createdBy: 'owner',
      },
    });
    await expect(
      runPartnerImport(partnerCtx(disabled, fakeServices().media, 'AIzaTESTE'), imp2.id),
    ).rejects.toThrow(/Drive API não está ativada/);
  });

  it('Caçador: candidatos com evidência e rascunho (nunca envia); frase vaga não vira permissão', async () => {
    const yt: FetchLike = async (u) => {
      const p = new URL(u);
      if (p.pathname.endsWith('/search')) {
        return new Response(
          JSON.stringify({ items: [{ id: { channelId: 'UC1' } }, { id: { channelId: 'UC2' } }] }),
        );
      }
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'UC1',
              snippet: {
                title: 'Fulano GTA',
                description: 'Tudo de GTA 6! Cortes liberados, só dar os créditos.',
                customUrl: '@fulanogta',
                country: 'BR',
              },
              statistics: { subscriberCount: '25000', videoCount: '300' },
            },
            {
              id: 'UC2',
              snippet: { title: 'Receitas da Vó', description: 'Bolos e tortas' },
              statistics: { subscriberCount: '90000', videoCount: '50' },
            },
          ],
        }),
      );
    };
    const ctx = { prisma, log, youtubeApiKey: 'AIzaTESTE', fetchImpl: yt };
    const r = await runHunt(ctx, {});
    expect(r).toMatchObject({ found: 2, created: 1 });
    const p = await prisma.partner.findFirstOrThrow({ include: { permissions: true } });
    expect(p).toMatchObject({ stage: 'CANDIDATE', channelId: 'UC1', handle: '@fulanogta' });
    expect(p.permissions).toEqual([]);
    expect((p.evidence as { hints: string[] }).hints).toEqual(['cortes liberados']);
    expect(p.draftMessage).toContain('voz sintética');
    expect(p.draftMessage).toContain('não baixamos nada do YouTube');
    expect(await prisma.quotaLedger.count({ where: { bucket: 'search.list' } })).toBe(2);
    // Segunda rodada não duplica.
    expect((await runHunt(ctx, {})).created).toBe(0);
    // Agendado com o Caçador desligado: não roda.
    await setSetting(
      prisma,
      'partners',
      {
        huntWeekly: false,
        huntQueries: ['GTA 6'],
        huntMaxChannels: 15,
        minSubscribers: 1000,
        maxImportMb: 1024,
        maxClipMinutes: 20,
      },
      'owner',
    );
    expect((await runHunt(ctx, { scheduled: true })).skipped).toMatch(/desligado/);
  });

  async function reactFixture() {
    const { partner, permission } = await seedPartner(prisma);
    const asset = await prisma.asset.create({
      data: {
        kind: 'VIDEO',
        origin: 'PARTNER',
        title: 'Perseguição na ponte',
        storageKey: 'library/ab/abc.mp4',
        sha256: 'abc',
        mime: 'video/mp4',
        bytes: FAKE_MP4.length,
        durationSec: 40,
        partnerId: partner.id,
        createdBy: 'agent:importador',
        analysisStatus: 'READY',
        analysis: {
          language: 'pt',
          durationSec: 40,
          width: 1280,
          height: 720,
          hasAudio: true,
          speech: [
            [1, 4.5],
            [12, 16],
            [25, 27],
          ],
          segments: [
            { start: 1, end: 4.5, text: 'Olha a perseguição', music: false },
            { start: 12, end: 16, text: 'O carro voa na rampa', music: false },
            { start: 18, end: 24, text: '♪ la la ♪', music: true },
          ],
          music: [[18, 24]],
          loudness: Array.from({ length: 40 }, (_, i) => (i >= 12 && i < 17 ? -12 : -30)),
          scenes: [6, 12, 30],
          model: 'teste',
        },
        manifest: {
          create: {
            origin: 'PARTNER',
            license: 'Permissão do parceiro: cortes em Shorts de react',
            credit: 'Canal do Fulano',
            permissionId: permission.id,
            createdBy: 'agent:importador',
          },
        },
      },
    });
    await store.put('library/ab/abc.mp4', FAKE_MP4, 'video/mp4');
    const prod = await prisma.production.create({
      data: {
        kind: 'REACT',
        format: 'SHORT',
        partnerId: partner.id,
        sourceAssetId: asset.id,
        status: 'QUEUED',
        createdBy: 'owner',
      },
    });
    return { partner, permission, asset, prod };
  }

  const prodCtx = (svc: ReturnType<typeof fakeServices>): ProductionContext => ({
    prisma,
    log,
    store,
    mediaUrl: 'http://media',
    renderUrl: 'http://render',
    renderHeight: 720,
    workRoot,
    media: svc.media,
    render: svc.render,
    tts,
  });

  it('Short de react: clipe ≤ 45%, pausado nos comentários, crédito e condições na descrição', async () => {
    const { asset, prod } = await reactFixture();
    const svc = fakeServices();
    const r = await runReactProduction({ ...prodCtx(svc) }, prod.id);
    expect(r.status).toBe('READY');
    const final = await prisma.production.findUniqueOrThrow({ where: { id: prod.id } });
    const out = final.outputs as Record<string, unknown>;
    expect(out.clipRatio as number).toBeLessThanOrEqual(0.45);
    expect(out.commentRatio as number).toBeGreaterThanOrEqual(0.5);
    expect(out.description).toContain('Clipe: Canal do Fulano — https://www.youtube.com/@fulano');
    expect(out.description).toContain('#fulanogames');
    expect(out.audioMode).toBe('voice');
    expect(svc.renders[0]).toMatchObject({ composition: 'ReactShort', vertical: true });
    const plan = (svc.renders[0]!.props as { plan: { blocks: Array<{ kind: string }> } }).plan;
    expect(plan.blocks[0]!.kind).toBe('comment');
    // Cortes só com a voz do parceiro e nunca no trecho com música (18-24 s).
    for (const c of svc.cuts) {
      expect(c.audio_mode).toBe('voice');
      expect((c.end as number) <= 17.5 || (c.start as number) >= 24.5).toBe(true);
    }
    expect(await prisma.productionAsset.count({ where: { assetId: asset.id } })).toBe(1);
  });

  it('sem permissão ativa o pipeline para (3ª camada) e o áudio inteiro só com a marca do dono', async () => {
    const { permission, prod, asset } = await reactFixture();
    await prisma.partnerPermission.update({
      where: { id: permission.id },
      data: { status: 'SUSPENDED' },
    });
    await expect(
      runProductionJob(prodCtx(fakeServices()), { productionId: prod.id }, { made: 0, max: 2 }),
    ).rejects.toThrow(UnrecoverableError);
    const failed = await prisma.production.findUniqueOrThrow({ where: { id: prod.id } });
    expect(failed.status).toBe('FAILED');
    expect(failed.error).toMatch(/suspensa/);

    await prisma.partnerPermission.update({
      where: { id: permission.id },
      data: { status: 'ACTIVE' },
    });
    await prisma.asset.update({ where: { id: asset.id }, data: { audioCleared: true } });
    const again = await prisma.production.create({
      data: {
        kind: 'REACT',
        format: 'SHORT',
        partnerId: failed.partnerId,
        sourceAssetId: asset.id,
        status: 'QUEUED',
        createdBy: 'owner',
      },
    });
    const svc = fakeServices();
    expect((await runReactProduction(prodCtx(svc), again.id)).status).toBe('READY');
    expect(svc.cuts.every((c) => c.audio_mode === 'full')).toBe(true);
  });
});

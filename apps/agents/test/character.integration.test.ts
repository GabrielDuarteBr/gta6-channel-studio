import { createPrisma, ensureBible } from '@studio/db';
import { PolicyViolation } from '@studio/policy';
import type { TtsProvider } from '@studio/providers';
import { createLogger } from '@studio/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clipId, produceCharacterClip } from '../src/character/clip';
import { clipJobId, clipJobSchema } from '../src/character/job';
import { MediaService, RenderService, type FetchLike } from '../src/character/services';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

const ROTEIRO =
  '[feliz] Fala, galera do Radar! [pausa] [surpreso] [aponta_tela] Saiu novidade de GTA 6! ' +
  '[serio] Mas o preço ainda é rumor.';

/** Voz falsa em memória: 1 s por trecho. */
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

/** worker-media e render falsos, guardando o que receberam. */
function fakeServices() {
  const received: Record<string, unknown> = {};
  let polls = 0;
  const fetchImpl: FetchLike = async (u, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    const path = new URL(u).pathname;
    received[path] = body;
    const reply = (data: unknown) => new Response(JSON.stringify(data));
    if (path === '/audio/voice-track') {
      return reply({
        path: body.out,
        duration_sec: 4.5,
        segments: [
          { start: 0.2, end: 1.2 },
          { start: 1.6, end: 2.6 },
          { start: 2.6, end: 3.6 },
        ],
      });
    }
    if (path === '/lipsync') {
      return reply({
        duration_sec: 4.5,
        mouth_cues: [
          { start: 0, end: 0.3, value: 'X' },
          { start: 0.3, end: 0.9, value: 'D' },
          { start: 0.9, end: 1.5, value: 'B' },
        ],
      });
    }
    if (path === '/render') return reply({ id: 'r1', status: 'na fila' });
    if (path === '/render/r1') {
      polls++;
      return reply(
        polls < 2
          ? { id: 'r1', status: 'renderizando' }
          : {
              id: 'r1',
              status: 'pronto',
              report: {
                output: received['/render']
                  ? (received['/render'] as { output: string }).output
                  : '',
                width: 1280,
                height: 720,
                frames: 135,
                seconds: 12.3,
                bytes: 999,
              },
            },
      );
    }
    return new Response('{}', { status: 404 });
  };
  return {
    received,
    media: new MediaService('http://media', fetchImpl),
    render: new RenderService('http://render', fetchImpl, async () => {}),
  };
}

d('clipe de teste do personagem (pipeline com serviços falsos)', () => {
  const prisma = createPrisma(url as string);
  const log = createLogger('teste', 'silent');

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE "CharacterBible", "AuditLog", "CostLedger", "Setting" CASCADE',
    );
    await ensureBible(prisma);
  });
  afterAll(() => prisma.$disconnect());

  it('roteiro → voz por trecho → trilha → bocas → linha do tempo → render', async () => {
    const svc = fakeServices();
    const res = await produceCharacterClip(
      { prisma, log, tts, media: svc.media, render: svc.render },
      { script: ROTEIRO, layout: 'landscape' },
    );
    expect(res.expressions).toEqual(['feliz', 'surpreso', 'serio']);
    expect(res.gestures).toEqual(['aponta_tela']);
    expect(res.segments).toBe(3);
    expect(res.bibleVersion).toBe(1);
    expect(res.video).toMatch(/^clips\/[0-9a-f]{16}\/clipe\.mp4$/);

    const track = svc.received['/audio/voice-track'] as {
      segments: Array<{ pause_after_ms: number }>;
      lead_in_ms: number;
    };
    expect(track.segments.map((s) => s.pause_after_ms)).toEqual([400, 0, 0]);
    expect(track.lead_in_ms).toBe(200);

    const render = svc.received['/render'] as {
      composition: string;
      audio: string;
      vertical: boolean;
      props: {
        timeline: { expressions: unknown[]; gestures: unknown[] };
        captions: unknown[];
        provisional: boolean;
      };
    };
    expect(render.composition).toBe('ZecaClip');
    expect(render.audio).toMatch(/voz\.wav$/);
    expect(render.vertical).toBe(false);
    expect(render.props.provisional).toBe(true);
    expect(render.props.timeline.expressions).toEqual([
      { start: 0, end: 1.6, expression: 'feliz' },
      { start: 1.6, end: 2.6, expression: 'surpreso' },
      { start: 2.6, end: 4.5, expression: 'serio' },
    ]);
    expect(render.props.captions).toHaveLength(3);

    const cost = await prisma.costLedger.findFirstOrThrow({ where: { task: 'character:clip' } });
    expect(cost).toMatchObject({ provider: 'tts', model: 'fake', simulated: true });
    expect(
      await prisma.auditLog.count({ where: { action: 'character.clip', outcome: 'OK' } }),
    ).toBe(1);
  });

  it('regra 7: recusa roteiro em que o Zeca diz ser humano (sem gastar voz)', async () => {
    const svc = fakeServices();
    let spoken = 0;
    const counting: TtsProvider = {
      ...tts,
      synthesize: async (r) => (spoken++, tts.synthesize(r)),
    };
    await expect(
      produceCharacterClip(
        { prisma, log, tts: counting, media: svc.media, render: svc.render },
        { script: '[feliz] Pode confiar, eu sou humano igual a você.', layout: 'vertical' },
      ),
    ).rejects.toThrow(PolicyViolation);
    expect(spoken).toBe(0);
    expect(
      await prisma.auditLog.count({ where: { action: 'character.clip', outcome: 'DENIED' } }),
    ).toBe(1);
  });

  it('id do clipe e do job são estáveis; entrada inválida é recusada', () => {
    const a = clipId({ script: ROTEIRO, layout: 'landscape' });
    expect(clipId({ script: ROTEIRO, layout: 'landscape' })).toBe(a);
    expect(clipId({ script: ROTEIRO, layout: 'vertical' })).not.toBe(a);
    const data = clipJobSchema.parse({ script: ROTEIRO, layout: 'landscape' });
    const now = new Date('2026-11-15T10:00:30Z');
    expect(clipJobId(data, now)).toBe(clipJobId(data, new Date('2026-11-15T10:00:59Z')));
    expect(() => clipJobSchema.parse({ script: 'x', layout: 'quadrado' })).toThrow();
  });
});

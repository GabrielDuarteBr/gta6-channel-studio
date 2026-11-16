import { createPrisma, setSetting } from '@studio/db';
import { BudgetExceededError } from '@studio/llm';
import { ProviderError, type TtsProvider } from '@studio/providers';
import { UnrecoverableError } from '@studio/queue';
import { channelDay, createLogger } from '@studio/shared';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { runClipJob } from '../src/character/job';
import {
  googleCharsThisMonth,
  paidCostUsd,
  recordTts,
  TtsQuotaError,
  ttsForClip,
} from '../src/character/tts';

const url = process.env.TEST_DATABASE_URL;
const d = url ? describe : describe.skip;

describe('custo da voz do Google (cota grátis)', () => {
  it('só paga o que passa da cota, na hora em que passa', () => {
    const price = 30 / 1_000_000;
    expect(paidCostUsd(0, 1000, 1_000_000)).toBe(0);
    expect(paidCostUsd(999_500, 1000, 1_000_000)).toBeCloseTo(500 * price, 12);
    expect(paidCostUsd(1_200_000, 1000, 1_000_000)).toBeCloseTo(1000 * price, 12);
  });
});

d('voz do clipe: escolha, trava e ledger', () => {
  const prisma = createPrisma(url as string);
  const character = {
    ttsProvider: 'google' as const,
    googleVoice: 'pt-BR-Chirp3-HD-Puck',
    speakingRate: 1.05,
    freeCharsPerMonth: 1000,
    allowPaid: false,
    layout: 'landscape' as const,
  };
  const google = { id: 'google', label: 'g', real: true } as unknown as TtsProvider;

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE "Setting", "CostLedger", "AuditLog" CASCADE');
    await setSetting(prisma, 'character', character, 'owner');
  });
  afterAll(() => prisma.$disconnect());

  it('modo simulado ligado = voz de teste; pedido explícito no clipe = Google', async () => {
    await setSetting(prisma, 'mode.simulation', true, 'owner');
    const opts = { mediaUrl: 'http://m', googleApiKey: 'AIza-teste' };
    expect((await ttsForClip(prisma, opts)).id).toBe('fake');
    expect((await ttsForClip(prisma, { ...opts, override: 'google' })).id).toBe('google');
    await setSetting(prisma, 'mode.simulation', false, 'owner');
    expect((await ttsForClip(prisma, opts)).id).toBe('google');
  });

  it('sem chave, a voz do Google não é usada e a mensagem diz o que configurar', async () => {
    await expect(ttsForClip(prisma, { mediaUrl: 'http://m', override: 'google' })).rejects.toThrow(
      ProviderError,
    );
    // No job, falta de chave falha de vez (não gasta retentativa).
    const job = runClipJob(
      { prisma, log: createLogger('teste', 'silent'), mediaUrl: 'http://m', renderUrl: 'http://r' },
      { script: '[feliz] Teste da voz.', layout: 'landscape', tts: 'google' },
    );
    await expect(job).rejects.toThrow(UnrecoverableError);
    await expect(job).rejects.toThrow(/GOOGLE_TTS_API_KEY/);
  });

  it('ledger: caracteres e custo real; cache não entra; total do mês', async () => {
    expect(
      await recordTts(prisma, google, { chars: 600 }, 'character:clip', 'pt-BR-Chirp3-HD-Puck'),
    ).toBe(0);
    expect(await recordTts(prisma, google, { chars: 600, cached: true }, 'character:clip')).toBe(0);
    const paid = await recordTts(
      prisma,
      google,
      { chars: 600 },
      'character:clip',
      'pt-BR-Chirp3-HD-Puck',
    );
    expect(paid).toBeCloseTo((200 * 30) / 1_000_000, 12); // 1200 - 1000 grátis
    expect(await googleCharsThisMonth(prisma)).toBe(1200);
    const rows = await prisma.costLedger.findMany({ orderBy: { at: 'asc' } });
    expect(rows.map((r) => [r.model, r.characters, r.simulated])).toEqual([
      ['google:pt-BR-Chirp3-HD-Puck', 600, false],
      ['google:pt-BR-Chirp3-HD-Puck', 600, false],
    ]);
  });

  it('trava: para em 95% da cota grátis, a não ser que o dono libere pagar (com teto)', async () => {
    await setSetting(prisma, 'mode.simulation', false, 'owner');
    await prisma.costLedger.create({
      data: {
        dayKey: channelDay(),
        provider: 'tts',
        model: 'google:x',
        task: 't',
        characters: 900,
        costUsd: 0,
      },
    });
    const tts = await ttsForClip(prisma, { mediaUrl: 'http://m', googleApiKey: 'k' });
    // A trava roda antes de qualquer chamada ao Google: 900 já usados + 100 > 950 (95% de 1000).
    const inner = (tts as unknown as { inner: { opts: { guard: (n: number) => Promise<void> } } })
      .inner;
    await expect(inner.opts.guard(100)).rejects.toThrow(TtsQuotaError);
    await inner.opts.guard(40); // 940 cabe

    await setSetting(prisma, 'character', { ...character, allowPaid: true }, 'owner');
    await setSetting(prisma, 'budget', { monthlyBrl: 0.000001, dailyBrl: 0.000001 }, 'owner');
    const paidTts = await ttsForClip(prisma, { mediaUrl: 'http://m', googleApiKey: 'k' });
    const guard = (
      paidTts as unknown as { inner: { opts: { guard: (n: number) => Promise<void> } } }
    ).inner.opts.guard;
    await expect(guard(500)).rejects.toThrow(BudgetExceededError); // passa da cota e do teto
  });
});

import { describe, expect, it } from 'vitest';
import { brasiliaInstant, nextPublishSlot } from '../src/time';

describe('horários de publicação (Brasília)', () => {
  it('pega o próximo horário com folga e pula os ocupados', () => {
    const times = ['12:00', '18:00'];
    // 10:00 em Brasília: 12:00 tem 2 h de folga
    const now = brasiliaInstant('2026-11-18', '10:00');
    expect(nextPublishSlot(now, times).toISOString()).toBe('2026-11-18T15:00:00.000Z');
    // 11:00: 12:00 tem só 60 min (menos que 90) → 18:00
    expect(nextPublishSlot(brasiliaInstant('2026-11-18', '11:00'), times).toISOString()).toBe(
      '2026-11-18T21:00:00.000Z',
    );
    // 18:00 ocupado → dia seguinte 12:00
    const taken = [brasiliaInstant('2026-11-18', '18:00')];
    expect(
      nextPublishSlot(brasiliaInstant('2026-11-18', '13:00'), times, taken).toISOString(),
    ).toBe('2026-11-19T15:00:00.000Z');
  });
});

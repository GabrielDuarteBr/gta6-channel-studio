import { describe, expect, it } from 'vitest';
import { coerceSetting, defaultSetting, parseSetting } from '../src/settings';
import { renderDimensions } from '../src/profile';
import { channelDay, youtubeQuotaDay } from '../src/time';

describe('settings', () => {
  it('tem padrões seguros', () => {
    expect(defaultSetting('mode.simulation')).toBe(true);
    expect(defaultSetting('mode.autopilot')).toBe(false);
    expect(defaultSetting('limits.daily')).toEqual({ long: 1, shorts: 4 });
    expect(defaultSetting('budget')).toEqual({ monthlyUsd: 50, dailyUsd: 1.6 });
    expect(defaultSetting('channel.identity').characterName).toBe('Zeca Neon');
  });

  it('rejeita valores inválidos e cai no padrão ao ler lixo do banco', () => {
    expect(() => parseSetting('limits.daily', { long: -1, shorts: 4 })).toThrow();
    expect(coerceSetting('limits.daily', 'lixo')).toEqual({ long: 1, shorts: 4 });
  });
});

describe('time', () => {
  it('dia da cota do YouTube vira à meia-noite do Pacífico, não de Brasília', () => {
    // 2026-11-10 05:30 UTC = 02:30 em São Paulo (dia 10) e 21:30 do dia 9 no Pacífico
    const d = new Date('2026-11-10T05:30:00Z');
    expect(channelDay(d)).toBe('2026-11-10');
    expect(youtubeQuotaDay(d)).toBe('2026-11-09');
  });
});

describe('renderDimensions', () => {
  it('calcula 16:9 e 9:16', () => {
    expect(renderDimensions('landscape', 720)).toEqual({ width: 1280, height: 720 });
    expect(renderDimensions('vertical', 1080)).toEqual({ width: 1080, height: 1920 });
  });
});

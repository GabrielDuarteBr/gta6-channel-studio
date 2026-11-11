import { describe, expect, it } from 'vitest';
import {
  assertCanPromoteStory,
  canPromoteStory,
  detectContentFlags,
  isSpoilerWindowActive,
  looksLikeRumor,
  mergeFlags,
  NO_FLAGS,
  PolicyViolation,
} from '../src';

const window = { launchDate: '2026-11-19', windowDays: 30 };
const before = new Date('2026-11-11T12:00:00Z');
const after = new Date('2026-11-25T12:00:00Z');
const later = new Date('2027-01-30T12:00:00Z');

describe('detectContentFlags', () => {
  it('detecta vazamentos em inglês e português', () => {
    expect(detectContentFlags('GTA 6 leaked footage surfaces online').leak).toBe(true);
    expect(detectContentFlags('Vazamento de GTA VI mostra mapa').leak).toBe(true);
    expect(detectContentFlags('Cópia antecipada de GTA 6 aparece à venda').leak).toBe(true);
    expect(detectContentFlags('Rockstar divulga trailer 3 de GTA 6').leak).toBe(false);
  });

  it('trapaça só bloqueia em contexto online (códigos do modo história são oficiais)', () => {
    expect(detectContentFlags('All GTA 6 cheat codes for story mode').onlineCheats).toBe(false);
    expect(detectContentFlags('GTA 6 Online money glitch spreads').onlineCheats).toBe(true);
    expect(detectContentFlags('Mod menu para GTA 6').onlineCheats).toBe(true);
  });

  it('mods, cutscene e entretenimento in-game', () => {
    expect(detectContentFlags('Fan mod recreates Leonida in GTA 5').mods).toBe(true);
    expect(detectContentFlags('Modern Vice City looks stunning').mods).toBe(false);
    expect(detectContentFlags('Every GTA 6 cutscene ranked').cutscene).toBe(true);
    expect(detectContentFlags('GTA 6 radio stations revealed').inGameEntertainment).toBe(true);
  });

  it('agrega bandeiras de vários itens', () => {
    expect(mergeFlags([NO_FLAGS, { ...NO_FLAGS, leak: true }]).leak).toBe(true);
  });
});

describe('janela anti-spoiler', () => {
  it('ativa do lançamento até o fim da janela', () => {
    expect(isSpoilerWindowActive(window, before)).toBe(false);
    expect(isSpoilerWindowActive(window, after)).toBe(true);
    expect(isSpoilerWindowActive(window, later)).toBe(false);
  });
});

describe('canPromoteStory', () => {
  const official = { flags: NO_FLAGS, isRumor: false, independentSources: 1, officialCount: 1 };

  it('libera notícia oficial', () => {
    expect(canPromoteStory(official, window, before)).toMatchObject({ ok: true, reasons: [] });
  });

  it('bloqueia vazamento, trapaça online e mods', () => {
    expect(
      canPromoteStory({ ...official, flags: { ...NO_FLAGS, leak: true } }, window, before).ok,
    ).toBe(false);
    expect(
      canPromoteStory({ ...official, flags: { ...NO_FLAGS, onlineCheats: true } }, window, before)
        .ok,
    ).toBe(false);
    expect(
      canPromoteStory({ ...official, flags: { ...NO_FLAGS, mods: true } }, window, before).ok,
    ).toBe(false);
  });

  it('rumor precisa de 2 fontes independentes', () => {
    const rumor = { flags: NO_FLAGS, isRumor: true, independentSources: 1, officialCount: 0 };
    expect(canPromoteStory(rumor, window, before).ok).toBe(false);
    const ok = canPromoteStory({ ...rumor, independentSources: 2 }, window, before);
    expect(ok.ok).toBe(true);
    expect(ok.warnings.join()).toContain('rotular como rumor');
  });

  it('spoiler só bloqueia dentro da janela', () => {
    const s = { ...official, flags: { ...NO_FLAGS, spoilerRisk: true } };
    expect(canPromoteStory(s, window, before).ok).toBe(true);
    expect(canPromoteStory(s, window, after).ok).toBe(false);
  });

  it('versão assert lança PolicyViolation com a regra certa', () => {
    try {
      assertCanPromoteStory(
        { flags: NO_FLAGS, isRumor: true, independentSources: 1, officialCount: 0 },
        window,
        before,
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyViolation);
      expect((e as PolicyViolation).rule).toBe('FACTS_HAVE_SOURCES');
    }
  });
});

describe('looksLikeRumor', () => {
  it('reconhece linguagem de rumor', () => {
    expect(looksLikeRumor('GTA 6 could be delayed again, insider claims')).toBe(true);
    expect(looksLikeRumor('Rumor: GTA 6 terá mapa maior')).toBe(true);
    expect(looksLikeRumor('Rockstar confirms GTA 6 release date')).toBe(false);
  });
});

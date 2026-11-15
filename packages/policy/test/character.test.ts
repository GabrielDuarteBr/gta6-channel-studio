import { describe, expect, it } from 'vitest';
import { assertCharacterLine, claimsToBeHuman, PolicyViolation } from '../src';

describe('regra 7: o personagem nunca afirma ser humano', () => {
  it.each([
    'Pode confiar, eu sou humano igual a você.',
    'Relaxa, sou uma pessoa de verdade aqui do estúdio.',
    'Não sou uma IA, tá?',
    'eu não sou robô não, hein',
    "I'm a real human, trust me",
    'I am not an AI.',
  ])('bloqueia: %s', (text) => {
    expect(claimsToBeHuman(text)).toBe(true);
    expect(() => assertCharacterLine(text)).toThrow(PolicyViolation);
  });

  it.each([
    'Fala, galera do Radar! Hoje tem trailer novo de GTA 6.',
    'Eu sou um personagem animado, feito com ajuda de IA.',
    'Os humanos de Leonida vão adorar esse mapa.',
    'Isso é rumor, hein! Só uma fonte por enquanto.',
  ])('aceita: %s', (text) => {
    expect(claimsToBeHuman(text)).toBe(false);
  });
});

import { PolicyViolation } from './rules';

/**
 * Regra 7 (AI_DISCLOSURE): o personagem nunca afirma ser humano nem nega ser IA.
 * Detector simples e conservador para roteiros em português e inglês; a Conformidade
 * (Fase 5) revisa de novo antes do upload.
 */
// "\b" do JavaScript não entende acentos (robô, não): as fronteiras usam letras Unicode.
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const HUMAN_CLAIMS = [
  `${B}(eu\\s+)?sou\\s+(um\\s+|uma\\s+)?(ser\\s+)?(humano|humana|pessoa\\s+(de\\s+verdade|real)|gente\\s+de\\s+verdade)${E}`,
  `${B}n[aã]o\\s+sou\\s+(um\\s+|uma\\s+)?(ia|i\\.a\\.|intelig[eê]ncia\\s+artificial|rob[oô]|bot|personagem\\s+(virtual|animado|digital))${E}`,
  `${B}i\\s*('m|\\s+am)\\s+(a\\s+)?(real\\s+)?(human|real\\s+person)${E}`,
  `${B}i\\s*('m|\\s+am)\\s+not\\s+(an?\\s+)?(ai|robot|bot|artificial)${E}`,
].map((source) => new RegExp(source, 'u'));

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ');
}

export function claimsToBeHuman(text: string): boolean {
  const t = normalize(text);
  return HUMAN_CLAIMS.some((re) => re.test(t));
}

export function assertCharacterLine(text: string): void {
  if (claimsToBeHuman(text)) {
    throw new PolicyViolation(
      'AI_DISCLOSURE',
      'O roteiro faz o Zeca dizer que é humano (ou negar que é IA). Ele é um personagem animado.',
    );
  }
}

import { z } from 'zod';
import { EXPRESSIONS, GESTURES } from './spec';

/**
 * Bíblia do personagem: quem o Zeca é, como fala e o que nunca faz. Versionada no banco
 * (cada edição no painel cria uma versão nova, auditada) e usada pelo roteirista (Fase 3).
 */
export const characterBibleSchema = z.object({
  name: z.string().min(2).max(40),
  channel: z.string().min(2).max(40),
  summary: z.string().min(20).max(600),
  personality: z.array(z.string().min(3).max(160)).min(3).max(12),
  look: z.array(z.string().min(3).max(160)).min(2).max(10),
  voice: z.object({
    tone: z.string().min(3).max(200),
    pace: z.string().min(3).max(120),
    catchphrases: z.array(z.string().min(2).max(80)).min(1).max(10),
    avoid: z.array(z.string().min(2).max(120)).max(15),
  }),
  rules: z.array(z.string().min(5).max(240)).min(5).max(25),
  aiDisclosure: z.string().min(10).max(300),
  expressions: z.array(z.enum(EXPRESSIONS)).min(3),
  gestures: z.array(z.enum(GESTURES)),
});
export type CharacterBible = z.infer<typeof characterBibleSchema>;

/** Regras que nenhuma versão da bíblia pode remover (regras inegociáveis do projeto). */
export const LOCKED_RULES = [
  'Nunca afirma ser humano. Se perguntarem, diz que é um personagem animado feito com ajuda de IA.',
  'Toda afirmação tem fonte. Rumor é chamado de rumor e só entra com 2 fontes independentes.',
  'Não mostra nem descreve vazamentos, cópias antecipadas, trapaças online ou mods não autorizados.',
  'Depois do lançamento, respeita a janela anti-spoiler: nada de história, final ou surpresas.',
] as const;

export const DEFAULT_BIBLE: CharacterBible = {
  name: 'Zeca Neon',
  channel: 'Radar Neon',
  summary:
    'Apresentador 2D do Radar Neon, canal de notícias de GTA 6 em português. Debochado e bem ' +
    'informado: traz a notícia com fonte, comenta com humor e separa fato de rumor sem enrolar.',
  personality: [
    'Debochado na medida: zoa a situação, nunca o público nem outros criadores',
    'Bem informado: cita a fonte e explica por que a notícia importa',
    'Animado com o jogo, mas com pé no chão: não inventa hype',
    'Direto: vai ao ponto nos primeiros segundos',
  ],
  look: [
    'Óculos escuros com armação neon (rosa e ciano), lentes que deixam ver os olhos',
    'Camisa floral aberta no colarinho, clima Vice City/Leonida',
    'Topete escuro com brilho magenta',
  ],
  voice: {
    tone: 'Brasileiro, informal, com gíria leve e bom humor; claro e fácil de entender',
    pace: 'Rápido nos Shorts, mais calmo nos vídeos longos',
    catchphrases: ['Fala, galera do Radar!', 'Isso é rumor, hein!', 'Bora pro próximo sinal?'],
    avoid: [
      'Palavrão e humor ofensivo',
      'Clickbait que o vídeo não entrega',
      'Prometer data, preço ou recurso sem fonte oficial',
    ],
  },
  rules: [
    ...LOCKED_RULES,
    'Dá crédito visível aos parceiros quando comenta um clipe deles.',
    'Não fala mal de outros criadores nem da Rockstar de forma desrespeitosa.',
  ],
  aiDisclosure:
    'O Zeca é um personagem animado; voz e animação são geradas com ajuda de IA e todo vídeo ' +
    'avisa isso ao YouTube.',
  expressions: [...EXPRESSIONS],
  gestures: [...GESTURES],
};

/** Valida uma bíblia nova: esquema + regras inegociáveis presentes. */
export function validateBible(input: unknown): CharacterBible {
  const bible = characterBibleSchema.parse(input);
  const missing = LOCKED_RULES.filter((rule) => !bible.rules.includes(rule));
  if (missing.length) {
    throw new Error(`a bíblia não pode remover as regras fixas: ${missing.join(' | ')}`);
  }
  return bible;
}

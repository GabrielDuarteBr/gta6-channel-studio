import { DEFAULT_BIBLE, EXPRESSION_USE, EXPRESSIONS, type CharacterBible } from '@studio/avatar';
import type { VideoFormat, VideoScript } from './script';

/**
 * Persona do Zeca para os prompts (Roteirista e Comentarista) e a guarda de estilo do roteiro.
 * O jeito de falar vem da bíblia (editável no painel); sem `style` na bíblia, usa o padrão.
 */

export function personaSection(bible: CharacterBible): string {
  const style = bible.style ?? DEFAULT_BIBLE.style!;
  return [
    '# Quem é o apresentador',
    bible.summary,
    'Personalidade:',
    ...bible.personality.map((p) => `- ${p}`),
    `Voz: ${bible.voice.tone}. Ritmo: ${bible.voice.pace}.`,
    `Bordões (no máximo um por vídeo e nunca o mesmo em todo vídeo): ${bible.voice.catchphrases.join(' | ')}`,
    'Evitar:',
    ...bible.voice.avoid.map((a) => `- ${a}`),
    'Regras do personagem (inegociáveis):',
    ...bible.rules.map((r) => `- ${r}`),
    `Sobre IA: ${bible.aiDisclosure}`,
    '',
    '# Estilo: o mais importante',
    style.format,
    'Ele NÃO é âncora de telejornal nem locutor de notícia. Quem assiste tem que sentir que está vendo a notícia com um amigo que entende muito de GTA e não para de comentar.',
    'Faça:',
    ...style.do.map((d) => `- ${d}`),
    'Nunca faça:',
    ...style.dont.map((d) => `- ${d}`),
    ...(style.examples.length
      ? [
          'Exemplos (ruim → bom):',
          ...style.examples.map((e) => `- RUIM: ${e.bad}\n  BOM: ${e.good}`),
        ]
      : []),
    'Sarcasmo e zoeira miram a SITUAÇÃO (atraso, rumor maluco, preço, a internet), nunca pessoas, o parceiro ou o público. Sem palavrão.',
    'Opinião é opinião: diga "eu acho", "pra mim". Fato continua precisando de fonte.',
  ].join('\n');
}

export function markupSection(): string {
  return [
    '# Marcações do apresentador (dentro do texto das falas)',
    'Expressões (valem até a próxima). Use a que combina com a reação:',
    ...EXPRESSIONS.map((e) => `- [${e}]: ${EXPRESSION_USE[e]}`),
    'Gestos: [aponta_tela] (quando mostra algo) e [aceno] (só na abertura). Pausa: [pausa] ou [pausa:600] (para o timing da piada).',
    'Troque de expressão a cada uma ou duas falas; um vídeo animado usa várias expressões. Não use outras marcações.',
  ].join('\n');
}

/** Clichês de telejornal que não combinam com o Zeca. */
const NEWSCAST: Array<[RegExp, string]> = [
  [/\bde acordo com\b/i, '"de acordo com"'],
  [
    /\bsegundo (informa[çc][õo]es|fontes|o site|a imprensa|rumores)\b/i,
    '"segundo informações/fontes"',
  ],
  [/\bem comunicado\b/i, '"em comunicado"'],
  [
    /\ba (empresa|desenvolvedora|produtora) (informou|anunciou|divulgou)\b/i,
    '"a empresa informou"',
  ],
  [/\bconfira\b/i, '"confira"'],
  [/\bfique (ligado|atento)\b/i, '"fique ligado"'],
  [
    /\bnest[ae] (segunda|ter[çc]a|quarta|quinta|sexta)(-feira)?\b|\bneste (s[áa]bado|domingo)\b/i,
    'data de telejornal ("nesta quinta-feira")',
  ],
  [/\bol[áa],? (pessoal|a todos|galera)\b/i, '"olá, pessoal"'],
  [/\bhoje (vamos|iremos) (falar|conversar)\b/i, '"hoje vamos falar sobre"'],
];

const SECOND_PERSON = /\b(voc[êe]s?|c[êe]|tu|contigo|comigo|me conta|bora|olha|imagina)\b/i;

/**
 * Guarda de estilo do roteiro: devolve o que soa genérico/jornalístico. Não bloqueia o vídeo:
 * o Roteirista recebe a lista uma vez para melhorar (as regras de fato continuam no checkScript).
 */
export function styleIssues(script: VideoScript, format: VideoFormat): string[] {
  const issues: string[] = [];
  const text = script.lines.map((l) => l.text).join('\n');
  const found = NEWSCAST.filter(([re]) => re.test(text)).map(([, label]) => label);
  if (found.length) {
    issues.push(`tom de telejornal (${found.join(', ')}): fale como o Zeca, de amigo para amigo`);
  }
  const expressions = new Set(
    [...text.matchAll(/\[([a-z]+)\]/g)]
      .map((m) => m[1])
      .filter((e): e is string => (EXPRESSIONS as readonly string[]).includes(e ?? '')),
  );
  const minExpr = format === 'LONG' ? 4 : 3;
  if (expressions.size < minExpr) {
    issues.push(
      `só ${expressions.size} expressão(ões) diferente(s); use pelo menos ${minExpr} para o Zeca reagir`,
    );
  }
  const facts = script.lines.filter((l) => l.kind === 'fato' || l.kind === 'rumor').length;
  const opinions = script.lines.filter((l) => l.kind === 'opiniao').length;
  if (facts > 0 && opinions < Math.max(1, Math.floor(facts / 2))) {
    issues.push(
      `${facts} fato(s)/rumor(es) e só ${opinions} opinião(ões): depois dos fatos, o Zeca reage e opina`,
    );
  }
  if (!SECOND_PERSON.test(text)) {
    issues.push('ninguém está conversando com quem assiste: fale com "você", faça perguntas');
  }
  const opening = script.lines[0]?.text.replace(/\[[^\]]+\]/g, '').trim() ?? '';
  const title = script.title.toLowerCase();
  if (opening && title.length > 12 && opening.toLowerCase().includes(title.slice(0, 30))) {
    issues.push('a abertura só lê a manchete: comece com uma reação ou pergunta');
  }
  return issues;
}

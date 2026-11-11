import { normalizeText } from './text';

/**
 * A notícia é sobre GTA 6? Fontes gerais de games publicam de tudo; só passa
 * o que cita o jogo (GTA 6/VI, Grand Theft Auto VI) ou termos inequívocos.
 * Fontes "só GTA" (sites de fãs, canal da Rockstar) aceitam também Rockstar/Leonida.
 */
const STRONG = /\b(gta6|leonida)\b/;
const RELATED =
  /\b(rockstar|taketwo|vicecity|lucia|jason duval|port gellhorn|ambrosia|grassrivers)\b/;
/** Outros jogos da Rockstar que não são GTA 6. */
const OTHER_GAMES =
  /\b(red dead|rdr2|rdr 2|gta online|gta 5|gta v|gtav|gta 4|gta iv|san andreas|bully|max payne|la noire)\b/;

export function isAboutGta6(
  title: string,
  summary: string | undefined,
  gtaFocusedSource: boolean,
): boolean {
  const t = normalizeText(`${title} ${summary ?? ''}`);
  if (STRONG.test(t)) return true;
  if (!gtaFocusedSource) return false;
  // Em sites focados em GTA/Rockstar: aceita termos relacionados se não for de outro jogo.
  const titleOnly = normalizeText(title);
  return RELATED.test(titleOnly) && !OTHER_GAMES.test(titleOnly);
}

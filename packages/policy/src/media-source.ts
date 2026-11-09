import { PolicyViolation } from './rules';

/**
 * Domínios de onde o sistema NUNCA importa mídia.
 * Os Termos do YouTube só permitem baixar com autorização do YouTube e do
 * dono do conteúdo; a permissão do criador sozinha não basta.
 */
export const BLOCKED_MEDIA_HOST_SUFFIXES = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'youtubekids.com',
  'googlevideo.com',
  'ytimg.com',
  'ggpht.com',
] as const;

function hostMatches(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function isBlockedMediaHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  return BLOCKED_MEDIA_HOST_SUFFIXES.some((s) => hostMatches(host, s));
}

/**
 * Valida uma URL antes de importar mídia para a Biblioteca.
 * Aceita só https e recusa qualquer domínio do YouTube.
 */
export function assertMediaImportAllowed(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PolicyViolation('NO_YOUTUBE_DOWNLOAD', `URL inválida: ${rawUrl}`);
  }
  if (url.protocol !== 'https:') {
    throw new PolicyViolation('NO_YOUTUBE_DOWNLOAD', 'Só são aceitos links https.');
  }
  if (url.username || url.password) {
    throw new PolicyViolation(
      'NO_YOUTUBE_DOWNLOAD',
      'Links com credenciais embutidas não são aceitos.',
    );
  }
  if (isBlockedMediaHost(url.hostname)) {
    throw new PolicyViolation(
      'NO_YOUTUBE_DOWNLOAD',
      `Importar mídia do YouTube (${url.hostname}) é proibido. Peça ao parceiro o arquivo original por link de pasta compartilhada.`,
    );
  }
  return url;
}

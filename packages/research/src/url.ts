/** Parâmetros de rastreamento removidos da URL canônica. */
const TRACKING_PARAMS =
  /^(utm_[a-z]+|fbclid|gclid|dclid|mc_cid|mc_eid|igshid|ref|ref_src|cmpid|ito|taid|ns_source|ns_mchannel|ns_campaign)$/i;

/**
 * URL canônica para deduplicação: https, host minúsculo sem "www." repetido,
 * sem fragmento, sem parâmetros de rastreamento e sem barra final.
 */
export function canonicalUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';
  url.username = '';
  url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1 && url.pathname.endsWith('/'))
    url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString();
}

/** Sufixos públicos de dois níveis mais comuns nas fontes do canal. */
const TWO_LEVEL_SUFFIXES = new Set([
  'com.br',
  'net.br',
  'org.br',
  'co.uk',
  'org.uk',
  'com.au',
  'co.jp',
  'com.mx',
  'com.ar',
  'com.pt',
]);

/** Domínio registrável (ex.: br.ign.com → ign.com; tecmundo.com.br → tecmundo.com.br). */
export function registrableDomain(urlOrHost: string): string {
  let host = urlOrHost;
  try {
    host = new URL(urlOrHost).hostname;
  } catch {
    /* já é host */
  }
  const parts = host.toLowerCase().replace(/\.$/, '').split('.');
  if (parts.length <= 2) return parts.join('.');
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_LEVEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

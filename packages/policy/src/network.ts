/**
 * Endereços que o coletor nunca busca: rede interna, nomes dos serviços do Docker,
 * metadados da nuvem (169.254.169.254) e loopback. Evita que uma fonte cadastrada
 * (pelo dono ou, no futuro, por um agente) faça o servidor ler a própria rede (SSRF).
 */
const INTERNAL_SUFFIXES = ['localhost', 'localdomain', 'local', 'internal', 'lan', 'home.arpa'];

function isInternalIpv4(host: string): boolean | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local / metadados da nuvem
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224 // multicast e reservados
  );
}

export function isInternalHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (!host) return true;
  const v4 = isInternalIpv4(host);
  if (v4 !== null) return v4;
  if (host.includes(':')) {
    return (
      host === '::' ||
      host === '::1' ||
      host.startsWith('fc') ||
      host.startsWith('fd') ||
      host.startsWith('fe80') ||
      host.startsWith('::ffff:') // IPv4 mapeado (ex.: ::ffff:127.0.0.1)
    );
  }
  // Sem ponto = nome de serviço da rede do Docker (postgres, redis, s3, agents...).
  if (!host.includes('.')) return true;
  return INTERNAL_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

/** https, sem credenciais embutidas e fora da rede interna. */
export function isPublicHttpsUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && !isInternalHost(u.hostname);
  } catch {
    return false;
  }
}

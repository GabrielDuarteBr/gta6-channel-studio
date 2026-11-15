import path from 'node:path';

/** Caminho dentro da pasta de trabalho (nunca fora dela). Nulo se o caminho for inválido. */
export function workPath(relative: string, root: string): string | null {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._/-]*$/.test(relative)) return null;
  const base = path.resolve(root);
  const full = path.resolve(base, relative);
  return full.startsWith(base + path.sep) ? full : null;
}

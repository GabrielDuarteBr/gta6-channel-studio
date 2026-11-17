import { createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { isAllowedDownloadHost, PolicyViolation, type ShareLink } from '@studio/policy';

/**
 * Download dos arquivos que o parceiro compartilhou (Dropbox ou Google Drive; nunca YouTube).
 * Cada redirecionamento é conferido (https e só hosts do Dropbox/Google), o tamanho tem teto e
 * o arquivo vai direto para a pasta de trabalho, sem passar pela memória.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const WORK_ROOT = path.resolve(process.env.MEDIA_WORK_ROOT ?? '/data/work');

/** Caminho absoluto de um relativo da pasta de trabalho (nunca escapa dela). */
export function workFile(relative: string, root = WORK_ROOT): string {
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
    throw new Error('caminho fora da pasta de trabalho');
  }
  return full;
}

export class DownloadError extends Error {
  override name = 'DownloadError';
  constructor(
    message: string,
    /** Falha que não adianta tentar de novo (link errado, sem permissão, grande demais). */
    readonly permanent = true,
  ) {
    super(message);
  }
}

const REDIRECT = new Set([301, 302, 303, 307, 308]);

/** GET seguindo redirecionamentos, conferindo cada salto. */
export async function fetchChecked(
  fetchImpl: FetchLike,
  url: string,
  headers: Record<string, string> = {},
  maxHops = 6,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const u = new URL(current);
    if (u.protocol !== 'https:' || !isAllowedDownloadHost(u.hostname)) {
      throw new PolicyViolation(
        'PARTNER_PERMISSION_ACTIVE',
        `Download levado para um site não permitido (${u.hostname}). Só Dropbox e Google Drive.`,
      );
    }
    const res = await fetchImpl(current, {
      headers: { 'user-agent': 'RadarNeonStudio/1.0', ...headers },
      redirect: 'manual',
      signal: AbortSignal.timeout(30 * 60_000),
    });
    if (REDIRECT.has(res.status)) {
      const location = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!location) throw new DownloadError('redirecionamento sem destino');
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new DownloadError('redirecionamentos demais');
}

/** Nome do arquivo no cabeçalho Content-Disposition (filename* ou filename). */
export function dispositionName(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)?.[1];
  if (star) {
    try {
      return decodeURIComponent(star.trim().replace(/^"|"$/g, ''));
    } catch {
      /* cai no filename simples */
    }
  }
  return /filename\s*=\s*"?([^";]+)"?/.exec(header)?.[1]?.trim() ?? null;
}

/** Grava o corpo da resposta num arquivo, parando se passar do teto. */
export async function saveBody(res: Response, dest: string, maxBytes: number): Promise<number> {
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    throw new DownloadError(`arquivo maior que o limite (${Math.round(maxBytes / 1_048_576)} MB)`);
  }
  if (!res.body) throw new DownloadError('resposta vazia', false);
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  let total = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > maxBytes) {
        cb(
          new DownloadError(`arquivo maior que o limite (${Math.round(maxBytes / 1_048_576)} MB)`),
        );
      } else cb(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(res.body as unknown as WebReadableStream),
      limiter,
      createWriteStream(tmp),
    );
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  await rename(tmp, dest);
  return total;
}

/** Tipo pelos primeiros bytes: vídeo (mp4/mov/mkv/webm) ou .zip (pasta do Dropbox). */
export async function sniffMedia(
  file: string,
): Promise<'mp4' | 'mov' | 'mkv' | 'webm' | 'zip' | null> {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(64);
    await fh.read(buf, 0, 64, 0);
    if (buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'zip';
    if (buf.subarray(4, 8).toString('latin1') === 'ftyp') {
      return buf.subarray(8, 12).toString('latin1') === 'qt  ' ? 'mov' : 'mp4';
    }
    if (buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
      return buf.includes(Buffer.from('webm')) ? 'webm' : 'mkv';
    }
    return null;
  } finally {
    await fh.close();
  }
}

export interface DownloadedFile {
  /** Relativo à pasta de trabalho. */
  path: string;
  name: string;
  bytes: number;
}

interface DriveError {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    errors?: Array<{ reason?: string }>;
    details?: Array<{ reason?: string }>;
  };
}

/** Mensagem clara para os erros mais comuns da API do Google Drive. */
export async function driveProblem(res: Response): Promise<DownloadError> {
  const body = (await res.json().catch(() => ({}))) as DriveError;
  const reasons = [
    ...(body.error?.errors ?? []).map((e) => e.reason),
    ...(body.error?.details ?? []).map((d) => d.reason),
    body.error?.status,
  ].filter(Boolean) as string[];
  if (reasons.some((r) => /accessNotConfigured|SERVICE_DISABLED/i.test(r))) {
    return new DownloadError(
      'A Google Drive API não está ativada no projeto da chave. Ative em console.cloud.google.com (APIs e serviços → Google Drive API) e tente de novo.',
    );
  }
  if (reasons.some((r) => /API_KEY_SERVICE_BLOCKED|API_KEY_.*BLOCKED/i.test(r))) {
    return new DownloadError(
      'A chave do Google não tem permissão para a Drive API (restrição da chave). Libere a "Google Drive API" na chave ou crie uma GOOGLE_DRIVE_API_KEY.',
    );
  }
  if (res.status === 404) {
    return new DownloadError(
      'Arquivo ou pasta do Drive não encontrado. Peça ao parceiro para compartilhar como "Qualquer pessoa com o link".',
    );
  }
  if (res.status === 403 && reasons.some((r) => /quota|rateLimit|downloadQuota/i.test(r))) {
    return new DownloadError(
      'O Drive limitou os downloads deste arquivo. Tente mais tarde.',
      false,
    );
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    return new DownloadError(
      `O Drive recusou (${body.error?.message ?? `HTTP ${res.status}`}). Confira a chave e se o arquivo está como "Qualquer pessoa com o link".`,
    );
  }
  return new DownloadError(`Google Drive respondeu HTTP ${res.status}`, false);
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
}

const safeName = (name: string) =>
  name
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^\.+/, '')
    .slice(-120) || 'arquivo';

export interface DownloadOptions {
  /** Pasta (relativa à pasta de trabalho) onde os arquivos ficam. */
  dir: string;
  maxBytes: number;
  maxFiles?: number;
  /** Chave do Google (Drive API) — vai no cabeçalho, nunca na URL. */
  driveKey?: string | undefined;
  fetchImpl?: FetchLike;
  root?: string;
}

/** Baixa o que o link do parceiro aponta. Pasta do Dropbox chega como um .zip. */
export async function downloadShareLink(
  link: ShareLink,
  opts: DownloadOptions,
): Promise<DownloadedFile[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const root = opts.root ?? WORK_ROOT;
  const maxFiles = opts.maxFiles ?? 20;

  if (link.provider === 'dropbox') {
    const res = await fetchChecked(fetchImpl, link.url);
    if (res.status === 404 || res.status === 410) {
      throw new DownloadError('Link do Dropbox não encontrado ou expirado.');
    }
    if (!res.ok)
      throw new DownloadError(
        `Dropbox respondeu HTTP ${res.status}`,
        res.status >= 500 ? false : true,
      );
    const type = res.headers.get('content-type') ?? '';
    if (type.startsWith('text/html')) {
      await res.body?.cancel().catch(() => undefined);
      throw new DownloadError(
        'O Dropbox devolveu uma página em vez do arquivo: o link precisa estar aberto para qualquer pessoa.',
      );
    }
    const name =
      dispositionName(res.headers.get('content-disposition')) ??
      decodeURIComponent(new URL(link.url).pathname.split('/').pop() ?? 'arquivo');
    const rel = `${opts.dir}/${link.folder ? 'pasta.zip' : `download-${safeName(name)}`}`;
    const bytes = await saveBody(res, workFile(rel, root), opts.maxBytes);
    return [{ path: rel, name, bytes }];
  }

  if (!opts.driveKey) {
    throw new DownloadError(
      'Falta a chave do Google para o Drive (GOOGLE_DRIVE_API_KEY no .env, ou a YOUTUBE_API_KEY com a Drive API ativada).',
    );
  }
  const headers = { 'x-goog-api-key': opts.driveKey, accept: 'application/json' };
  let files: DriveFile[];
  if (link.folder) {
    const q = `'${link.id}' in parents and trashed = false`;
    const url =
      `${DRIVE_API}?q=${encodeURIComponent(q)}&fields=${encodeURIComponent('files(id,name,mimeType,size)')}` +
      '&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true';
    const res = await fetchChecked(fetchImpl, url, headers);
    if (!res.ok) throw await driveProblem(res);
    files = ((await res.json()) as { files?: DriveFile[] }).files ?? [];
  } else {
    const url = `${DRIVE_API}/${encodeURIComponent(link.id)}?fields=id,name,mimeType,size&supportsAllDrives=true`;
    const res = await fetchChecked(fetchImpl, url, headers);
    if (!res.ok) throw await driveProblem(res);
    files = [(await res.json()) as DriveFile];
  }
  const videos = files.filter((f) => f.mimeType?.startsWith('video/')).slice(0, maxFiles);
  if (videos.length === 0) {
    throw new DownloadError(
      link.folder ? 'A pasta do Drive não tem vídeos.' : 'O arquivo do Drive não é um vídeo.',
    );
  }
  const out: DownloadedFile[] = [];
  for (const [i, f] of videos.entries()) {
    if (f.size && Number(f.size) > opts.maxBytes) {
      throw new DownloadError(
        `"${f.name}" passa do limite de ${Math.round(opts.maxBytes / 1_048_576)} MB.`,
      );
    }
    const res = await fetchChecked(
      fetchImpl,
      `${DRIVE_API}/${encodeURIComponent(f.id)}?alt=media&supportsAllDrives=true`,
      { 'x-goog-api-key': opts.driveKey },
    );
    if (!res.ok) throw await driveProblem(res);
    const rel = `${opts.dir}/drive-${i}-${safeName(f.name)}`;
    const bytes = await saveBody(res, workFile(rel, root), opts.maxBytes);
    out.push({ path: rel, name: f.name, bytes });
  }
  return out;
}

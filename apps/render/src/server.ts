import { createHash } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { ensureBrowser } from '@remotion/renderer';
import { baseEnvSchema, createLogger, parseEnv, profileDefaults } from '@studio/shared';
import { z } from 'zod';
import { getServeUrl, renderComposition } from './render';
import { workPath as resolveWorkPath } from './work-path';

const log = createLogger('render');
const env = parseEnv(baseEnvSchema);
const profile = profileDefaults(env.APP_PROFILE);
const PORT = Number(process.env.PORT ?? 4200);
const WORK_ROOT = path.resolve(process.env.MEDIA_WORK_ROOT ?? '/data/work');
let browser: 'pending' | 'ready' | 'error' = 'pending';
let bundleReady = false;

// Na imagem Docker o Chrome Headless Shell já vem baixado; aqui só confere.
ensureBrowser(
  process.env.REMOTION_BROWSER_EXECUTABLE
    ? { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE }
    : {},
)
  .then(() => {
    browser = 'ready';
    log.info('chrome headless pronto');
  })
  .catch((err: unknown) => {
    browser = 'error';
    log.error({ err }, 'chrome headless indisponível');
  });

const workPath = (relative: string) => resolveWorkPath(relative, WORK_ROOT);

const MEDIA_TYPES: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  // Camadas SVG da arte do personagem (conferidas no envio: sem script nem link externo).
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/** Serve arquivos da pasta de trabalho (rede interna): áudio para o Chrome, vídeo para o painel. */
function serveWorkFile(req: IncomingMessage, res: ServerResponse, relative: string): void {
  const full = workPath(relative);
  const type = full ? MEDIA_TYPES[path.extname(full)] : undefined;
  if (!full || !type) {
    res.writeHead(400).end();
    return;
  }
  let size: number;
  try {
    const st = statSync(full);
    if (!st.isFile()) throw new Error('não é arquivo');
    size = st.size;
  } catch {
    res.writeHead(404).end();
    return;
  }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.writeHead(416, { 'content-range': `bytes */${size}` }).end();
      return;
    }
    res.writeHead(206, {
      'content-type': type,
      'content-length': end - start + 1,
      'content-range': `bytes ${start}-${end}/${size}`,
      'accept-ranges': 'bytes',
    });
    createReadStream(full, { start, end }).pipe(res);
    return;
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
  createReadStream(full).pipe(res);
}

const renderRequest = z.object({
  composition: z.enum(['ZecaClip', 'RivePoc', 'HelloZeca', 'NewsVideo', 'Thumbnail', 'ReactShort']),
  props: z.record(z.string(), z.unknown()),
  /** Relativo à pasta de trabalho: .mp4 (vídeo) ou .png (quadro único). */
  output: z.string().regex(/\.(mp4|png)$/),
  still: z.boolean().optional(),
  /** Áudio (relativo à pasta de trabalho) para o ZecaClip; vira URL local para o Chrome. */
  audio: z.string().optional(),
  height: z.union([z.literal(720), z.literal(1080)]).optional(),
  vertical: z.boolean().optional(),
});

// Um render por vez no notebook (perfil): os pedidos esperam na fila deste processo.
let queue: Promise<unknown> = Promise.resolve();

async function readJson(req: IncomingMessage, limit = 5_000_000): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error('pedido grande demais');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

interface RenderJob {
  id: string;
  status: 'na fila' | 'renderizando' | 'pronto' | 'falhou';
  composition: string;
  output: string;
  report?: Record<string, unknown>;
  error?: string;
  createdAt: number;
}
const jobs = new Map<string, RenderJob>();

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Pede um render e responde na hora com o id (o render pode levar minutos; quem pediu
 * consulta GET /render/<id>). O id é o caminho de saída: pedir de novo o mesmo arquivo
 * enquanto ele está na fila ou renderizando devolve o mesmo trabalho (sem duplicar).
 */
async function handleRender(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const parsed = renderRequest.safeParse(await readJson(req).catch(() => null));
  const output = parsed.success ? workPath(parsed.data.output) : null;
  const audio = parsed.success && parsed.data.audio ? workPath(parsed.data.audio) : undefined;
  if (!parsed.success || !output || audio === null) {
    sendJson(res, 400, { error: 'pedido de render inválido' });
    return;
  }
  const body = parsed.data;
  const id = createHash('sha256').update(body.output).digest('hex').slice(0, 24);
  const existing = jobs.get(id);
  if (existing && (existing.status === 'na fila' || existing.status === 'renderizando')) {
    sendJson(res, 202, existing);
    return;
  }
  const job: RenderJob = {
    id,
    status: 'na fila',
    composition: body.composition,
    output: body.output,
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  // Guarda só os últimos 200 trabalhos na memória.
  for (const key of [...jobs.keys()].slice(0, Math.max(0, jobs.size - 200))) jobs.delete(key);

  if (Boolean(body.still) !== body.output.endsWith('.png')) {
    sendJson(res, 400, { error: 'quadro único sai em .png; vídeo em .mp4' });
    return;
  }
  const props = { ...body.props };
  if (body.audio) props.audioSrc = `http://127.0.0.1:${PORT}/work/${body.audio}`;
  // Imagens e voz das composições de notícia vêm da pasta de trabalho por esta base.
  props.workBaseUrl = `http://127.0.0.1:${PORT}/work`;
  const run = queue.then(async () => {
    job.status = 'renderizando';
    const report = await renderComposition({
      id: body.composition,
      inputProps: props,
      output,
      height: body.height ?? profile.renderHeight,
      vertical: body.vertical,
      concurrency: profile.renderConcurrency,
      still: body.still,
    });
    job.status = 'pronto';
    job.report = { ...report, output: path.relative(WORK_ROOT, report.output) };
    log.info(
      { composition: body.composition, output: body.output, seconds: report.seconds },
      'render ok',
    );
  });
  queue = run.catch((err: unknown) => {
    job.status = 'falhou';
    job.error = (err as Error).message.slice(0, 500);
    log.error({ err, composition: body.composition }, 'render falhou');
  });
  sendJson(res, 202, job);
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://render');
  if (req.method === 'GET' && url.pathname === '/health') {
    const ok = browser === 'ready';
    res.writeHead(ok ? 200 : 503, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(
      JSON.stringify({
        status: ok ? 'ok' : 'degraded',
        service: 'render',
        profile: env.APP_PROFILE,
        browser,
        bundle: bundleReady ? 'pronto' : 'preparando',
      }),
    );
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/work/')) {
    serveWorkFile(req, res, decodeURIComponent(url.pathname.slice('/work/'.length)));
    return;
  }
  if (req.method === 'POST' && url.pathname === '/render') {
    void handleRender(req, res);
    return;
  }
  if (req.method === 'GET' && url.pathname.startsWith('/render/')) {
    const job = jobs.get(url.pathname.slice('/render/'.length));
    if (job) sendJson(res, 200, job);
    else sendJson(res, 404, { error: 'trabalho de render não encontrado' });
    return;
  }
  res.writeHead(404).end();
});

// Conexões ociosas ficam abertas mais tempo que o intervalo de consulta dos clientes.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.listen(PORT, '0.0.0.0', () => log.info('render no ar'));
// Faz o bundle do Remotion já na subida (o primeiro render não espera por ele).
getServeUrl()
  .then(() => {
    bundleReady = true;
    log.info('bundle do Remotion pronto');
  })
  .catch((err: unknown) => log.error({ err }, 'bundle do Remotion falhou'));
process.on('SIGTERM', () => server.close(() => process.exit(0)));

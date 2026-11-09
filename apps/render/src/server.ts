import { createServer } from 'node:http';
import { ensureBrowser } from '@remotion/renderer';
import { baseEnvSchema, createLogger, parseEnv } from '@studio/shared';

const log = createLogger('render');
const env = parseEnv(baseEnvSchema);
let browser: 'pending' | 'ready' | 'error' = 'pending';

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

// Fase 3: worker BullMQ da fila "render" (1 job por vez no notebook).
const server = createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
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
      }),
    );
    return;
  }
  res.writeHead(404).end();
});
server.listen(Number(process.env.PORT ?? 4200), '0.0.0.0', () => log.info('render no ar'));

process.on('SIGTERM', () => server.close(() => process.exit(0)));

import { createServer, type Server } from 'node:http';

export type HealthCheck = () => Promise<Record<string, unknown>>;

/** Servidor HTTP mínimo só para /health (rede interna do Compose). */
export function startHealthServer(port: number, check: HealthCheck): Server {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/health') {
      res.writeHead(404).end();
      return;
    }
    check()
      .then((body) => {
        const ok = body.status === 'ok';
        res.writeHead(ok ? 200 : 503, {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify(body));
      })
      .catch(() => {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'down' }));
      });
  });
  server.listen(port, '0.0.0.0');
  return server;
}

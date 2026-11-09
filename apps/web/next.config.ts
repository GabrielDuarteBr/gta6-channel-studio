import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  },
];

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: root,
  poweredByHeader: false,
  transpilePackages: ['@studio/shared', '@studio/db', '@studio/policy', '@studio/queue'],
  serverExternalPackages: ['@node-rs/argon2', 'pino', 'ioredis', 'bullmq'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default config;

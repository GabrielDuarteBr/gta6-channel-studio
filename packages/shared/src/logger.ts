import pino, { type Logger } from 'pino';

/** Campos que nunca podem aparecer nos logs. */
export const REDACT_PATHS = [
  'password',
  '*.password',
  'passwordHash',
  '*.passwordHash',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'refreshToken',
  '*.refreshToken',
  'apiKey',
  '*.apiKey',
  'secret',
  '*.secret',
  'totp',
  '*.totp',
  'totpSecret',
  '*.totpSecret',
  'authorization',
  '*.authorization',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
];

/** Padrões de segredos conhecidos em texto livre (mensagens de erro, respostas de API). */
const SECRET_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{10,}/g, // Anthropic
  /sk-[A-Za-z0-9_-]{20,}/g, // OpenAI e similares
  /AIza[0-9A-Za-z_-]{30,}/g, // Google API key
  /ya29\.[0-9A-Za-z_-]{20,}/g, // Google access token
  /1\/\/[0-9A-Za-z_-]{30,}/g, // Google refresh token
  /\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, // Telegram bot token
  /(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/gi,
  /(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/gi, // senha em URL do Postgres
  /(rediss?:\/\/[^:\s]*:)[^@\s]+@/gi, // senha em URL do Redis
];

/** Mascara segredos conhecidos em uma string. */
export function scrubSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, prefix?: string) =>
      typeof prefix === 'string' && match.startsWith(prefix)
        ? `${prefix}[REDACTED]${match.endsWith('@') ? '@' : ''}`
        : '[REDACTED]',
    );
  }
  return out;
}

export function createLogger(service: string, level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    name: service,
    level,
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    formatters: {
      level: (label) => ({ level: label }),
    },
    hooks: {
      // Também mascara segredos dentro de mensagens de texto.
      logMethod(args, method) {
        const scrubbed = args.map((a) => (typeof a === 'string' ? scrubSecrets(a) : a));
        method.apply(this, scrubbed as Parameters<typeof method>);
      },
    },
    serializers: {
      err: (err: unknown) => {
        const s = pino.stdSerializers.err(err as Error);
        return { ...s, message: scrubSecrets(s.message ?? ''), stack: scrubSecrets(s.stack ?? '') };
      },
    },
  });
}

export type { Logger };

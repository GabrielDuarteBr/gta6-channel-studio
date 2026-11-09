import { z } from 'zod';

export const APP_PROFILES = ['notebook', 'vps'] as const;
export type AppProfile = (typeof APP_PROFILES)[number];

/** Aceita true/false/1/0 vindos de variáveis de ambiente. */
export const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const base64Key32 = z
  .string()
  .refine((v) => Buffer.from(v, 'base64').length === 32, {
    message: 'precisa ser uma chave de 32 bytes em base64 (gere com `make setup`)',
  });

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_PROFILE: z.enum(APP_PROFILES).default('notebook'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SIMULATION_MODE: booleanish.default(true),
});

export const databaseEnvSchema = z.object({
  DATABASE_URL: z
    .string()
    .refine((v) => /^postgres(ql)?:\/\//.test(v), { message: 'precisa ser uma URL postgresql://' }),
});

export const redisEnvSchema = z.object({
  REDIS_URL: z.string().refine((v) => /^rediss?:\/\//.test(v), {
    message: 'precisa ser uma URL redis://',
  }),
});

export const authEnvSchema = z.object({
  AUTH_SECRET: z.string().min(32, 'precisa ter pelo menos 32 caracteres'),
  TOKEN_ENCRYPTION_KEY: base64Key32,
});

export const s3EnvSchema = z.object({
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY: z.string().min(8),
  S3_SECRET_KEY: z.string().min(16),
});

export const serviceUrlsEnvSchema = z.object({
  AGENTS_URL: z.string().url().default('http://agents:4100'),
  RENDER_URL: z.string().url().default('http://render:4200'),
  MEDIA_URL: z.string().url().default('http://worker-media:4300'),
  S3_HEALTH_URL: z.string().url().optional(),
});

export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Valida variáveis de ambiente com um schema zod.
 * A mensagem de erro cita só os NOMES das variáveis, nunca os valores.
 */
export function parseEnv<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`Configuração inválida — ${issues}`);
  }
  return result.data;
}

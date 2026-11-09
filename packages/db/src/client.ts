import { PrismaPg } from '@prisma/adapter-pg';
import { databaseEnvSchema, parseEnv } from '@studio/shared';
import { PrismaClient } from './generated/prisma/client';

const globalForPrisma = globalThis as unknown as { __studioPrisma?: PrismaClient };

export function createPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
}

/** Cliente único por processo (reaproveitado no hot reload do Next em dev). */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__studioPrisma) {
    const { DATABASE_URL } = parseEnv(databaseEnvSchema);
    globalForPrisma.__studioPrisma = createPrisma(DATABASE_URL);
  }
  return globalForPrisma.__studioPrisma;
}

export type { PrismaClient };

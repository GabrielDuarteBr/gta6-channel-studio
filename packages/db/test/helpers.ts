import { describe } from "vitest";
import { randomBytes } from 'node:crypto';
import { createPrisma, type PrismaClient } from '../src';

export const TEST_DB = process.env.TEST_DATABASE_URL;
/** Testes de integração só rodam com TEST_DATABASE_URL (local com `make test` e no CI). */
export const describeDb = TEST_DB ? describe : describe.skip;

export const testKey = randomBytes(32);

export function testPrisma(): PrismaClient {
  return createPrisma(TEST_DB as string);
}

export async function resetDb(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "User", "Setting", "AuditLog", "JobRun", "CostLedger", "QuotaLedger", "OAuthToken" CASCADE',
  );
}

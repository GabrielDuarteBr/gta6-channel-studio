import { scrubSecrets } from '@studio/shared';
import type { PrismaClient } from './generated/prisma/client';
import type { AuditOutcome, Prisma } from './generated/prisma/client';

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  outcome?: AuditOutcome;
  details?: Record<string, unknown>;
}

type Db = Pick<PrismaClient, 'auditLog'> | Prisma.TransactionClient;

/** Grava uma entrada de auditoria. Detalhes passam pelo filtro de segredos. */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  const details = entry.details
    ? (JSON.parse(scrubSecrets(JSON.stringify(entry.details))) as Prisma.InputJsonValue)
    : undefined;
  await db.auditLog.create({
    data: {
      actor: entry.actor,
      action: entry.action,
      target: entry.target ?? null,
      outcome: entry.outcome ?? 'OK',
      ...(details === undefined ? {} : { details }),
    },
  });
}

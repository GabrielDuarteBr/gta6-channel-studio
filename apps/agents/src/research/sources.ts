import { audit, type PrismaClient } from '@studio/db';
import { DEFAULT_SOURCES } from '@studio/research';

/**
 * Cria as fontes padrão que ainda não existem. Não sobrescreve nada que o dono
 * já mexeu (ativar/desativar, URL corrigida) — só completa o que falta.
 */
export async function seedDefaultSources(prisma: PrismaClient): Promise<number> {
  let created = 0;
  for (const s of DEFAULT_SOURCES) {
    const exists = await prisma.source.findUnique({ where: { key: s.key }, select: { id: true } });
    if (exists) continue;
    await prisma.source.create({
      data: {
        key: s.key,
        name: s.name,
        kind: s.kind,
        tier: s.tier,
        url: s.url,
        language: s.language,
        enabled: s.enabled ?? true,
        builtIn: true,
        ...(s.config ? { config: s.config } : {}),
        ...(s.disabledReason ? { lastStatus: 'desativada', lastError: s.disabledReason } : {}),
      },
    });
    created++;
  }
  return created;
}

const FIX_ACTION = 'source.default-fix';

/**
 * Leva para quem já tinha as fontes as correções das fontes padrão que passaram a vir
 * desativadas (ex.: site que mudou de endereço ou bloqueia robôs). Só mexe se a fonte
 * ainda está como veio (mesmo endereço, ativa) e só UMA vez: se o dono reativar depois,
 * a auditoria lembra que a correção já foi aplicada e ela não volta a desativar.
 */
export async function applyDefaultSourceFixes(prisma: PrismaClient): Promise<string[]> {
  const applied: string[] = [];
  for (const def of DEFAULT_SOURCES) {
    if (def.enabled !== false || !def.disabledReason) continue;
    const done = await prisma.auditLog.findFirst({
      where: { action: FIX_ACTION, target: def.key },
      select: { id: true },
    });
    if (done) continue;
    const source = await prisma.source.findUnique({ where: { key: def.key } });
    const untouched = source?.builtIn && source.enabled && source.url === def.url;
    if (source && untouched) {
      await prisma.source.update({
        where: { id: source.id },
        data: { enabled: false, lastStatus: 'desativada', lastError: def.disabledReason },
      });
      applied.push(def.key);
    }
    await audit(prisma, {
      actor: 'system',
      action: FIX_ACTION,
      target: def.key,
      details: { applied: Boolean(source && untouched), reason: def.disabledReason },
    });
  }
  return applied;
}

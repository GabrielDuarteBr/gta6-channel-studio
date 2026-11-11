import type { PrismaClient } from '@studio/db';
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
      },
    });
    created++;
  }
  return created;
}

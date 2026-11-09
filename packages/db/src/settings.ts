import {
  coerceSetting,
  parseSetting,
  SETTING_KEYS,
  type SettingKey,
  type SettingsMap,
  type SettingValue,
} from '@studio/shared';
import { audit } from './audit';
import type { Prisma, PrismaClient } from './generated/prisma/client';

export async function getSetting<K extends SettingKey>(
  prisma: PrismaClient,
  key: K,
): Promise<SettingValue<K>> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return coerceSetting(key, row?.value);
}

export async function getAllSettings(prisma: PrismaClient): Promise<SettingsMap> {
  const rows = await prisma.setting.findMany({ where: { key: { in: SETTING_KEYS } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(
    SETTING_KEYS.map((k) => [k, coerceSetting(k, byKey.get(k))]),
  ) as SettingsMap;
}

/** Valida e grava uma configuração, com auditoria na mesma transação. */
export async function setSetting<K extends SettingKey>(
  prisma: PrismaClient,
  key: K,
  value: unknown,
  actor: string,
): Promise<SettingValue<K>> {
  const parsed = parseSetting(key, value);
  const json = parsed as unknown as Prisma.InputJsonValue;
  await prisma.$transaction(async (tx) => {
    const before = await tx.setting.findUnique({ where: { key } });
    await tx.setting.upsert({
      where: { key },
      create: { key, value: json, updatedBy: actor },
      update: { value: json, updatedBy: actor },
    });
    await audit(tx, {
      actor,
      action: 'settings.update',
      target: key,
      details: { before: before?.value ?? null, after: parsed as unknown },
    });
  });
  return parsed;
}

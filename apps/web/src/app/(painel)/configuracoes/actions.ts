'use server';

import { getPrisma, setSetting } from '@studio/db';
import { isSettingKey, type SettingKey } from '@studio/shared';
import { revalidatePath } from 'next/cache';
import { requireOwner } from '@/server/session';

export interface SaveState {
  ok?: boolean;
  error?: string;
  savedAt?: number;
}

const num = (form: FormData, name: string) =>
  Number(String(form.get(name) ?? '').replace(',', '.'));

/** Converte o formulário de cada seção no valor tipado da configuração. */
function valueFor(key: SettingKey, form: FormData): unknown {
  switch (key) {
    case 'mode.simulation':
      return form.get('enabled') === 'on';
    case 'mode.autopilot':
      // Ligar o piloto automático chega na Fase 7 (com confirmação por 2FA).
      throw new Error('O piloto automático só pode ser ligado a partir da Fase 7.');
    case 'profile.override':
      return String(form.get('profile') ?? 'env');
    case 'limits.daily':
      return { long: num(form, 'long'), shorts: num(form, 'shorts') };
    case 'budget':
      return { monthlyUsd: num(form, 'monthlyUsd'), dailyUsd: num(form, 'dailyUsd') };
    case 'render.resolution':
      return String(form.get('resolution') ?? 'auto');
    case 'antiSpoiler':
      return {
        launchDate: String(form.get('launchDate') ?? ''),
        windowDays: num(form, 'windowDays'),
      };
    case 'research':
      return {
        intervalMinutes: num(form, 'intervalMinutes'),
        windowHours: num(form, 'windowHours'),
        youtubeSearchesPerDay: num(form, 'youtubeSearchesPerDay'),
      };
    case 'channel.identity':
      return {
        channelName: String(form.get('channelName') ?? '').trim(),
        characterName: String(form.get('characterName') ?? '').trim(),
        language: String(form.get('language') ?? '').trim(),
      };
  }
}

export async function saveSettingAction(_prev: SaveState, form: FormData): Promise<SaveState> {
  await requireOwner();
  const key = String(form.get('key') ?? '');
  if (!isSettingKey(key)) return { error: 'Configuração desconhecida.' };
  try {
    await setSetting(getPrisma(), key, valueFor(key, form), 'owner');
  } catch (err) {
    const message =
      err instanceof Error && err.name === 'ZodError'
        ? 'Valor inválido. Confira os campos.'
        : err instanceof Error
          ? err.message
          : 'Erro ao salvar.';
    return { error: message };
  }
  revalidatePath('/', 'layout');
  return { ok: true, savedAt: Date.now() };
}

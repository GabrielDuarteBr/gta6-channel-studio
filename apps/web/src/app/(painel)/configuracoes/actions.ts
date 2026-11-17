'use server';

import { audit, getPrisma, setSetting, verifyOwnerTotp } from '@studio/db';
import {
  encryptionEnvSchema,
  isSettingKey,
  loadEncryptionKey,
  parseEnv,
  type SettingKey,
} from '@studio/shared';
import { revalidatePath } from 'next/cache';
import { runDailyNow, syncMetricsNow } from '@/server/publish';
import { requireOwner } from '@/server/session';
import { disconnectYouTube } from '@/server/youtube';

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
      return form.get('enabled') === 'on';
    case 'profile.override':
      return String(form.get('profile') ?? 'env');
    case 'limits.daily':
      return { long: num(form, 'long'), shorts: num(form, 'shorts') };
    case 'budget':
      return { monthlyBrl: num(form, 'monthlyBrl'), dailyBrl: num(form, 'dailyBrl') };
    case 'currency':
      return {
        source: String(form.get('source') ?? 'bcb'),
        manualRate: num(form, 'manualRate'),
        iofPercent: num(form, 'iofPercent'),
        spreadPercent: num(form, 'spreadPercent'),
      };
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
    case 'character':
      return {
        ttsProvider: String(form.get('ttsProvider') ?? 'fake'),
        googleVoice: String(form.get('googleVoice') ?? '').trim(),
        speakingRate: num(form, 'speakingRate'),
        freeCharsPerMonth: num(form, 'freeCharsPerMonth'),
        allowPaid: form.get('allowPaid') === 'on',
        layout: String(form.get('layout') ?? 'landscape'),
      };
    case 'production':
      return {
        writerModel: String(form.get('writerModel') ?? ''),
        reviewerModel: String(form.get('reviewerModel') ?? ''),
        longTargetSec: num(form, 'longTargetSec'),
        shortTargetSec: num(form, 'shortTargetSec'),
        maxReviewRounds: num(form, 'maxReviewRounds'),
      };
    case 'images':
      return {
        provider: String(form.get('provider') ?? 'fake'),
        model: String(form.get('model') ?? '').trim(),
        maxPerLong: num(form, 'maxPerLong'),
        maxPerShort: num(form, 'maxPerShort'),
        style: String(form.get('style') ?? '').trim(),
      };
    case 'partners':
      return {
        huntWeekly: form.get('huntWeekly') === 'on',
        huntQueries: String(form.get('huntQueries') ?? '')
          .split(',')
          .map((q) => q.trim())
          .filter(Boolean),
        huntMaxChannels: num(form, 'huntMaxChannels'),
        minSubscribers: num(form, 'minSubscribers'),
        maxImportMb: num(form, 'maxImportMb'),
        maxClipMinutes: num(form, 'maxClipMinutes'),
      };
    case 'react':
      return {
        targetSec: num(form, 'targetSec'),
        maxClipRatio: num(form, 'maxClipPercent') / 100,
        commentatorModel: String(form.get('commentatorModel') ?? ''),
        layouts: form.getAll('layouts').map(String),
      };
    case 'youtube':
      return {
        categoryId: String(form.get('categoryId') ?? '20').trim(),
        defaultTags: String(form.get('defaultTags') ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        publishTimes: String(form.get('publishTimes') ?? '')
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .sort(),
        notifySubscribers: form.get('notifySubscribers') === 'on',
      };
    case 'schedule.daily':
      return {
        enabled: form.get('enabled') === 'on',
        time: String(form.get('time') ?? '07:41'),
        long: num(form, 'long'),
        newsShorts: num(form, 'newsShorts'),
        reacts: num(form, 'reacts'),
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
    const value = valueFor(key, form);
    // Ligar o piloto automático exige o código do app autenticador (desligar não).
    if (key === 'mode.autopilot' && value === true) {
      const owner = await requireOwner();
      const keyBuf = loadEncryptionKey(parseEnv(encryptionEnvSchema).TOKEN_ENCRYPTION_KEY);
      const ok = await verifyOwnerTotp(
        getPrisma(),
        keyBuf,
        owner.id,
        String(form.get('code') ?? ''),
      );
      if (!ok) {
        await audit(getPrisma(), {
          actor: 'owner',
          action: 'settings.autopilot',
          outcome: 'DENIED',
          details: { reason: 'totp' },
        });
        return { error: 'Código do app autenticador inválido.' };
      }
    }
    await setSetting(getPrisma(), key, value, 'owner');
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

export async function disconnectYouTubeAction(): Promise<void> {
  await requireOwner();
  await disconnectYouTube();
  revalidatePath('/', 'layout');
}

export async function runDailyNowAction(_p: SaveState): Promise<SaveState> {
  await requireOwner();
  await runDailyNow();
  return { ok: true, savedAt: Date.now() };
}

export async function syncMetricsNowAction(_p: SaveState): Promise<SaveState> {
  await requireOwner();
  await syncMetricsNow();
  return { ok: true, savedAt: Date.now() };
}

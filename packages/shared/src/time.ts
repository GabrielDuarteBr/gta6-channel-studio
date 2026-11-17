/** Chave de dia (AAAA-MM-DD) num fuso horário. */
export function dayKey(date: Date, timeZone: string): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Dia da cota do YouTube: zera à meia-noite do horário do Pacífico. */
export function youtubeQuotaDay(date: Date = new Date()): string {
  return dayKey(date, 'America/Los_Angeles');
}

/** Dia operacional do canal (orçamento diário, limites diários). */
export function channelDay(date: Date = new Date()): string {
  return dayKey(date, 'America/Sao_Paulo');
}

/** Mês operacional (AAAA-MM) para o orçamento mensal. */
export function channelMonth(date: Date = new Date()): string {
  return channelDay(date).slice(0, 7);
}

/** Brasília não tem mais horário de verão (desde 2019): sempre UTC−3. */
const BRT_OFFSET = '-03:00';

/** Data/hora de Brasília (AAAA-MM-DD + HH:MM) como instante. */
export function brasiliaInstant(day: string, time: string): Date {
  return new Date(`${day}T${time}:00${BRT_OFFSET}`);
}

/**
 * Próximo horário de publicação livre (Brasília), com pelo menos `leadMinutes` de folga para o
 * envio e o processamento do YouTube, sem repetir um horário já ocupado.
 */
export function nextPublishSlot(
  now: Date,
  times: string[],
  taken: Date[] = [],
  leadMinutes = 90,
): Date {
  const busy = new Set(taken.map((d) => d.getTime()));
  const sorted = [...times].sort();
  for (let offset = 0; offset < 60; offset += 1) {
    const day = channelDay(new Date(now.getTime() + offset * 86_400_000));
    for (const t of sorted) {
      const at = brasiliaInstant(day, t);
      if (at.getTime() - now.getTime() >= leadMinutes * 60_000 && !busy.has(at.getTime())) {
        return at;
      }
    }
  }
  throw new Error('nenhum horário livre nos próximos 60 dias');
}

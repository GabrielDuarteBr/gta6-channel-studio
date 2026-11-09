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

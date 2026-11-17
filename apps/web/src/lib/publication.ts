/** Rótulos do estado de uma publicação (Aprovação, Calendário, Visão geral). */
export const PUB_STATUS: Record<
  string,
  { label: string; tone: 'ok' | 'warn' | 'error' | 'info' | 'muted' }
> = {
  QUEUED: { label: 'na fila de envio', tone: 'info' },
  UPLOADING: { label: 'enviando', tone: 'warn' },
  SCHEDULED: { label: 'agendado (privado)', tone: 'ok' },
  PUBLISHED: { label: 'publicado', tone: 'ok' },
  MANUAL: { label: 'pacote manual', tone: 'warn' },
  FAILED: { label: 'falhou', tone: 'error' },
  CANCELED: { label: 'cancelado', tone: 'muted' },
};

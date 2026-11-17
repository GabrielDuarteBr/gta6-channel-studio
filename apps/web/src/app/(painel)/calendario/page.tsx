import { getAllSettings, getPrisma } from '@studio/db';
import { channelDay } from '@studio/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { Badge, Card, CardDescription, CardTitle } from '@/components/ui/card';
import { PUB_STATUS } from '@/lib/publication';
import { listPublications } from '@/server/publish';

export const metadata: Metadata = { title: 'Calendário' };
export const dynamic = 'force-dynamic';

const time = new Intl.DateTimeFormat('pt-BR', {
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});
const dayLabel = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: '2-digit',
  timeZone: 'America/Sao_Paulo',
});

export default async function CalendarPage() {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const to = new Date(now.getTime() + 21 * 86_400_000);
  const [pubs, settings] = await Promise.all([
    listPublications({ from, to }),
    getAllSettings(getPrisma()),
  ]);
  const visible = pubs.filter((p) => p.status !== 'CANCELED');
  const days: Array<{ key: string; date: Date }> = [];
  for (let i = -7; i <= 21; i++) {
    const date = new Date(now.getTime() + i * 86_400_000);
    days.push({ key: channelDay(date), date });
  }
  const byDay = new Map<string, typeof visible>();
  for (const p of visible) {
    const k = channelDay(p.publishAt);
    byDay.set(k, [...(byDay.get(k) ?? []), p]);
  }
  const today = channelDay(now);
  const limits = settings['limits.daily'];

  return (
    <>
      <PageHeader
        title="Calendário"
        subtitle={`Publicações da semana passada às próximas 3 semanas (horário de Brasília). Horários padrão: ${settings.youtube.publishTimes.join(', ')}. Limite: ${limits.long} longo(s) e ${limits.shorts} Shorts por dia.`}
      />
      <Card>
        <CardTitle>Agenda</CardTitle>
        <CardDescription>
          Para marcar um vídeo, aprove-o na{' '}
          <Link href="/aprovacao" className="underline">
            Aprovação
          </Link>
          .
        </CardDescription>
        <div
          className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7"
          data-testid="calendario"
        >
          {days.map((d) => {
            const items = byDay.get(d.key) ?? [];
            const past = d.key < today;
            return (
              <div
                key={d.key}
                className={`min-h-24 rounded-lg border p-2 ${d.key === today ? 'border-neon-cyan' : 'border-night-700'} ${past ? 'opacity-60' : ''}`}
                data-testid={`dia-${d.key}`}
              >
                <p className="text-xs font-semibold text-haze-300">
                  {dayLabel.format(d.date)}
                  {d.key === today ? ' · hoje' : ''}
                </p>
                <ul className="mt-1 space-y-1">
                  {items.map((p) => {
                    const st = PUB_STATUS[p.status] ?? { label: p.status, tone: 'muted' as const };
                    return (
                      <li
                        key={p.id}
                        className="rounded bg-night-800 p-1.5 text-xs"
                        data-testid="evento"
                      >
                        <p className="text-haze-400">
                          {time.format(p.publishAt)} ·{' '}
                          {p.production.format === 'SHORT'
                            ? p.production.kind === 'REACT'
                              ? 'react'
                              : 'Short'
                            : 'longo'}
                        </p>
                        <p className="line-clamp-2 text-white">{p.title}</p>
                        <Badge tone={st.tone} className="mt-1">
                          {st.label}
                          {p.simulated ? ' · simulado' : ''}
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </Card>
    </>
  );
}

'use client';

import { LogOut, Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { NAV } from '@/lib/nav';
import { Badge } from './ui/card';

export interface ShellProps {
  children: ReactNode;
  ownerEmail: string;
  simulation: boolean;
  profileLabel: string;
  signOutAction: () => Promise<void>;
}

export function Shell({
  children,
  ownerEmail,
  simulation,
  profileLabel,
  signOutAction,
}: ShellProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav aria-label="Principal" className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-neon-pink/15 text-white shadow-[inset_2px_0_0_var(--color-neon-pink)]'
                : 'text-haze-400 hover:bg-night-800 hover:text-white',
            )}
          >
            <Icon
              className={cn(
                'size-4 shrink-0',
                active ? 'text-neon-pink' : 'text-haze-500 group-hover:text-haze-300',
              )}
            />
            <span className="flex-1">{item.label}</span>
            {item.phase > 0 ? (
              <span className="text-[10px] text-haze-500">F{item.phase}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_1fr]">
      {/* Barra lateral (desktop) / gaveta (celular) */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-64 border-r border-night-800 bg-night-950/95 p-4 backdrop-blur transition-transform lg:sticky lg:top-0 lg:h-dvh lg:w-auto lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="mb-6 flex items-center justify-between">
          <Link href="/" className="font-display neon-text text-2xl">
            Radar Neon
          </Link>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="Fechar menu">
            <X className="size-5" />
          </button>
        </div>
        {nav}
      </aside>
      {open ? (
        <button
          className="fixed inset-0 z-30 bg-black/60 lg:hidden"
          aria-label="Fechar menu"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-night-800 bg-night-950/80 px-4 py-3 backdrop-blur">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
            <Menu className="size-5" />
          </button>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            {simulation ? (
              <Badge tone="warn" data-testid="badge-simulacao">
                Modo simulado
              </Badge>
            ) : (
              <Badge tone="error">Modo real</Badge>
            )}
            <Badge tone="info">{profileLabel}</Badge>
          </div>
          <span className="hidden text-xs text-haze-500 sm:inline">{ownerEmail}</span>
          <form action={signOutAction}>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-haze-400 hover:bg-night-800 hover:text-white"
            >
              <LogOut className="size-4" /> Sair
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
      </div>
    </div>
  );
}

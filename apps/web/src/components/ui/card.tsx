import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'rounded-2xl border border-night-700 bg-night-900/80 p-5 backdrop-blur',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: ComponentProps<'h2'>) {
  return <h2 className={cn('text-base font-semibold text-white', className)} {...props} />;
}

export function CardDescription({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn('mt-1 text-sm text-haze-400', className)} {...props} />;
}

type Tone = 'ok' | 'warn' | 'error' | 'muted' | 'info';
const tones: Record<Tone, string> = {
  ok: 'border-palm/40 bg-palm/10 text-palm',
  warn: 'border-sunset/40 bg-sunset/10 text-sunset',
  error: 'border-alert/40 bg-alert/10 text-alert',
  muted: 'border-night-600 bg-night-800 text-haze-400',
  info: 'border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan',
};

export function Badge({
  tone = 'muted',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}

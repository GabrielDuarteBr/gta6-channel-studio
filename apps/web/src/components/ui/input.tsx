import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-10 w-full rounded-lg border border-night-600 bg-night-900 px-3 text-sm text-white placeholder:text-haze-500 focus:border-neon-cyan focus:outline-none disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-10 w-full rounded-lg border border-night-600 bg-night-900 px-3 text-sm text-white focus:border-neon-cyan focus:outline-none disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium text-haze-300', className)} {...props} />;
}

/** Interruptor acessível baseado em checkbox nativo (funciona em formulários sem JS). */
export function Toggle({
  className,
  label,
  description,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & { label: string; description?: string }) {
  return (
    <label className={cn('flex cursor-pointer items-start justify-between gap-4', className)}>
      <span>
        <span className="block text-sm font-medium text-white">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-haze-400">{description}</span>
        ) : null}
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input type="checkbox" className="peer sr-only" {...props} />
        <span className="h-6 w-11 rounded-full bg-night-600 transition-colors peer-checked:bg-neon-pink peer-focus-visible:outline-2 peer-focus-visible:outline-neon-cyan peer-disabled:opacity-50" />
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

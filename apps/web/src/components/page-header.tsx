import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-3xl text-white sm:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-sm text-haze-400">{subtitle}</p> : null}
        <div className="sunset-line mt-3 h-0.5 w-20 rounded-full" />
      </div>
      {actions}
    </div>
  );
}

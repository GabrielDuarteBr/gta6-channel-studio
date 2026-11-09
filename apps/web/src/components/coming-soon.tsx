import { Construction } from 'lucide-react';
import { navItem } from '@/lib/nav';
import { PageHeader } from './page-header';
import { Card } from './ui/card';

/** Tela que ganha funcionalidade numa fase seguinte. */
export function ComingSoon({ href }: { href: string }) {
  const item = navItem(href);
  return (
    <>
      <PageHeader title={item.label} subtitle={item.description} />
      <Card className="flex items-start gap-4">
        <Construction className="mt-0.5 size-6 shrink-0 text-sunset" />
        <div>
          <p className="font-semibold text-white">Chega na Fase {item.phase}</p>
          <p className="mt-1 text-sm text-haze-400">
            A estrutura da tela já existe; a funcionalidade é construída e testada na Fase{' '}
            {item.phase}.
          </p>
        </div>
      </Card>
    </>
  );
}

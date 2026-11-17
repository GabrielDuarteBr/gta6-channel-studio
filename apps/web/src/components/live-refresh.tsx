'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

/** Atualiza a página sozinha quando o servidor avisa (SSE) que algo mudou. */
export function LiveRefresh({ src }: { src: string }) {
  const router = useRouter();
  const [live, setLive] = useState(false);
  useEffect(() => {
    const es = new EventSource(src);
    es.onopen = () => setLive(true);
    es.onerror = () => setLive(false);
    es.addEventListener('change', () => router.refresh());
    return () => es.close();
  }, [router, src]);
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-haze-400" data-testid="ao-vivo">
      <span className={`size-2 rounded-full ${live ? 'bg-palm' : 'bg-night-600'}`} />
      {live ? 'ao vivo' : 'reconectando…'}
    </span>
  );
}

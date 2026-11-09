import '@fontsource-variable/inter';
import '@fontsource/anton';
import './globals.css';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: { default: 'Radar Neon Studio', template: '%s · Radar Neon Studio' },
  description: 'Painel de operação do canal Radar Neon',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: '#07040f',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

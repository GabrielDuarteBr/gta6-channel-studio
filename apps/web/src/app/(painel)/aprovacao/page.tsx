import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'Aprovação' };

export default function Page() {
  return <ComingSoon href="/aprovacao" />;
}

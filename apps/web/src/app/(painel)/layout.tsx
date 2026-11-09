import type { ReactNode } from 'react';
import { signOut } from '@/auth';
import { Shell } from '@/components/shell';
import { effectiveState } from '@/server/effective';
import { requireOwner } from '@/server/session';

export const dynamic = 'force-dynamic';

export default async function PainelLayout({ children }: { children: ReactNode }) {
  const owner = await requireOwner();
  const { settings, profileInfo } = await effectiveState();

  async function signOutAction() {
    'use server';
    await signOut({ redirectTo: '/login' });
  }

  return (
    <Shell
      ownerEmail={owner.email}
      simulation={settings['mode.simulation']}
      profileLabel={profileInfo.label}
      signOutAction={signOutAction}
    >
      {children}
    </Shell>
  );
}

import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';

import { useSession } from '@/state/session';

/** Screens outside the tab group use this to send signed-out people to the login screen. */
export function RequireSession({ children }: { children: ReactNode }) {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (!session) return <Redirect href="/login" />;
  return <>{children}</>;
}

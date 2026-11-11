import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';

import '@/components/web-tabs-fit';
import { ToastProvider } from '@/components/toast';
import { SessionProvider } from '@/state/session';

export default function RootLayout() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <ToastProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </ToastProvider>
    </SessionProvider>
  );
}

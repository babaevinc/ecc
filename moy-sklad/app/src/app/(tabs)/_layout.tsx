import { Redirect } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { Platform } from 'react-native';

import { useSession } from '@/state/session';
import { usePalette } from '@/theme';

export default function TabsLayout() {
  const { session, ready } = useSession();
  const c = usePalette();
  if (!ready) return null;
  if (!session) return <Redirect href="/login" />;

  return (
    // iOS keeps the system (liquid glass) tab bar; the web preview gets theme colours.
    <NativeTabs tintColor={c.accent} {...(Platform.OS === 'web' ? { backgroundColor: c.card, indicatorColor: c.tint } : {})}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Главная</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="stock">
        <NativeTabs.Trigger.Label>Склады</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'shippingbox', selected: 'shippingbox.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="receive">
        <NativeTabs.Trigger.Label>Приход</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'plus.circle', selected: 'plus.circle.fill' }} />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notifications">
        <NativeTabs.Trigger.Label>Уведомления</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf={{ default: 'bell', selected: 'bell.fill' }} />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

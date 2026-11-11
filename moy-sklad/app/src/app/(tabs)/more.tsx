import { router } from 'expo-router';

import { Group, Row, Screen } from '@/components/ui';
import { useApi } from '@/state/session';

export default function MoreScreen() {
  const api = useApi();
  return (
    <Screen title="Ещё">
      <Group title="Этикетки">
        <Row title="Сканировать этикетку" subtitle="Камерой или подключённым сканером" onPress={() => router.push('/scan')} chevron />
        <Row title="Сканеры" subtitle="Добавить и проверить Bluetooth, USB и терминалы" onPress={() => router.push('/scanners')} chevron last />
      </Group>
      <Group>
        <Row title="Уведомления" subtitle="Заявки, отгрузки и старые партии" onPress={() => router.push('/notifications')} chevron last />
      </Group>
      <Group>
        <Row title="Выйти" onPress={() => api.signOut()} last />
      </Group>
    </Screen>
  );
}

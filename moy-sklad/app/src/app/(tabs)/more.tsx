import { router } from 'expo-router';

import { Group, Row, Screen } from '@/components/ui';
import { useApi } from '@/state/session';
import { useAccess } from '@/state/use-access';

export default function MoreScreen() {
  const api = useApi();
  const { role } = useAccess();
  return (
    <Screen title="Ещё">
      <Group title="Этикетки">
        <Row title="Сканировать этикетку" subtitle="Камерой или подключённым сканером" onPress={() => router.push('/scan')} chevron />
        <Row title="Сканеры" subtitle="Добавить и проверить Bluetooth, USB и терминалы" onPress={() => router.push('/scanners')} chevron last />
      </Group>
      {role === 'owner' ? (
        <Group title="Настройки">
          <Row title="Товары и склады" subtitle="Добавить, переименовать, убрать в архив или удалить" onPress={() => router.push('/catalog')} chevron last />
        </Group>
      ) : null}
      <Group>
        <Row title="Уведомления" subtitle="Заявки, отгрузки и старые партии" onPress={() => router.push('/notifications')} chevron last />
      </Group>
      <Group>
        <Row title="Выйти" onPress={() => api.signOut()} last />
      </Group>
    </Screen>
  );
}

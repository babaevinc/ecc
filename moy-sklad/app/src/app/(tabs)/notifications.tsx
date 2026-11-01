import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import type { AppNotification } from '@/api/types';
import { Group, Message, Row, Screen } from '@/components/ui';
import { STALE_DAYS } from '@/domain/stock';
import { useApi } from '@/state/session';
import { userMessage } from '@/state/use-stock-data';

function titleOf(n: AppNotification): string {
  const number = typeof n.payload.number === 'number' ? `№${n.payload.number}` : '';
  switch (n.kind) {
    case 'request_new': return `Новая заявка ${number}`.trim();
    case 'request_done': return `Заявка ${number} отгружена`.replace('  ', ' ');
    case 'request_cancelled': return `Заявка ${number} отменена`.replace('  ', ' ');
    case 'batch_stale': return `Партия лежит больше ${STALE_DAYS} дней`;
    default: return 'Уведомление';
  }
}

const when = (iso: string): string =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function NotificationsScreen() {
  const api = useApi();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.listNotifications());
      setError(null);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  return (
    <Screen title="Уведомления" refreshing={loading} onRefresh={reload}>
      {error ? <Message tone="error" text={error} /> : null}
      <Group>
        {items.length ? items.map((n, i) => (
          <Row key={n.id} title={titleOf(n)} subtitle={when(n.createdAt)} last={i === items.length - 1} />
        )) : <Row title={loading ? 'Загрузка…' : 'Здесь появятся заявки, отгрузки и старые партии'} last />}
      </Group>
    </Screen>
  );
}

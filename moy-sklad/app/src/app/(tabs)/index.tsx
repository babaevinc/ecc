import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';

import { Banner, Group, Message, Row, Screen, Segmented } from '@/components/ui';
import { formatQty, STALE_DAYS, staleBatches, summarizeByProduct, todayIso, WARN_DAYS } from '@/domain/stock';
import { useApi } from '@/state/session';
import { useStockData } from '@/state/use-stock-data';
import { type, usePalette } from '@/theme';

const ALL = 'all';

export default function HomeScreen() {
  const api = useApi();
  const c = usePalette();
  const { data, error, loading, reload } = useStockData();
  const [warehouse, setWarehouse] = useState(ALL);

  const today = todayIso();
  const scope = warehouse === ALL ? undefined : new Set([warehouse]);
  const summaries = data ? summarizeByProduct(data.batches, data.products, today, scope) : [];
  const stale = data ? staleBatches(data.batches.filter(b => !scope || scope.has(b.warehouseId)), today) : [];

  const signOut = (
    <Pressable accessibilityRole="button" onPress={() => api.signOut()}>
      <Text style={[type.body, { color: c.accent }]}>Выйти</Text>
    </Pressable>
  );

  return (
    <Screen title="Мой склад" refreshing={loading} onRefresh={reload} right={signOut}>
      {api.isDemo ? <Message tone="info" text="Демо-режим: показаны вымышленные данные" /> : null}
      {data && data.warehouses.length > 1 ? (
        <Segmented value={warehouse} onChange={setWarehouse}
          options={[{ value: ALL, label: 'Все склады' }, ...data.warehouses.map(w => ({ value: w.id, label: w.name }))]} />
      ) : null}
      {error ? <Message tone="error" text={error} /> : null}
      {stale.length ? (
        <Banner title={`${stale.length} ${stale.length === 1 ? 'партия лежит' : 'партий лежат'} больше ${STALE_DAYS} дней`}
          text="Продайте или спишите в первую очередь" onPress={() => router.push('/stock')} />
      ) : null}
      <Group title="По видам зелени">
        {summaries.length ? summaries.map((s, i) => (
          <Row key={s.productId} title={s.name} value={formatQty(s.total, s.unit)} last={i === summaries.length - 1}
            subtitle={s.oldestAgeDays !== null ? `старейшая партия: ${s.oldestAgeDays} дн.` : undefined}
            tone={s.oldestAgeDays !== null && s.oldestAgeDays >= WARN_DAYS ? 'warning' : 'normal'} />
        )) : <Row title={loading ? 'Загрузка…' : 'Пока пусто — добавьте приход'} last />}
      </Group>
    </Screen>
  );
}

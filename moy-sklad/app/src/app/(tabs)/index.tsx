import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Banner, Group, Message, Row, Screen, Segmented } from '@/components/ui';
import { can } from '@/domain/ops';
import { formatQty, STALE_DAYS, staleBatches, summarizeByProduct, todayIso, WARN_DAYS } from '@/domain/stock';
import { useApi } from '@/state/session';
import { useAccess } from '@/state/use-access';
import { useStockData } from '@/state/use-stock-data';
import { space, type, usePalette } from '@/theme';

const ALL = 'all';

export default function HomeScreen() {
  const api = useApi();
  const c = usePalette();
  const { data, error, loading, reload } = useStockData();
  const [warehouse, setWarehouse] = useState(ALL);
  const { role } = useAccess();
  const openShip = (mode: string) => router.push({ pathname: '/ship', params: { mode, t: String(Date.now()) } });
  // The four things done many times a day, one tap from the first screen.
  const actions = [
    ...(can.ship(role) ? [{ title: 'Приход', glyph: '↓', color: c.accent, go: () => router.push('/receive') }] : []),
    ...(can.sell(role) ? [{ title: 'Продажа', glyph: '₽', color: c.blue, go: () => openShip('sale') }] : []),
    ...(can.request(role) ? [{ title: 'Заявка', glyph: '+', color: c.warning, go: () => openShip('requests') }] : []),
    ...(can.writeOff(role) ? [{ title: 'Порча', glyph: '✕', color: c.danger, go: () => openShip('spoil') }] : []),
  ];

  const today = todayIso();
  const scope = warehouse === ALL ? undefined : new Set([warehouse]);
  const summaries = data ? summarizeByProduct(data.batches, data.products, today, scope) : [];
  const stale = data ? staleBatches(data.batches.filter(b => !scope || scope.has(b.warehouseId)), today) : [];

  const scanButton = (
    <Pressable accessibilityRole="button" accessibilityLabel="Сканировать этикетку" onPress={() => router.push('/scan')}>
      <Text style={[type.bodyBold, { color: c.accent }]}>Скан</Text>
    </Pressable>
  );

  return (
    <Screen title="Мой склад" refreshing={loading} onRefresh={reload} right={scanButton}>
      {api.isDemo ? <Message tone="info" text="Демо-режим: показаны вымышленные данные" /> : null}
      {actions.length ? (
        <View style={styles.actions}>
          {actions.map(a => (
            <Pressable key={a.title} accessibilityRole="button" accessibilityLabel={`Быстро: ${a.title}`} onPress={a.go}
              style={({ pressed }) => [styles.action, { backgroundColor: c.card, opacity: pressed ? 0.7 : 1 }]}>
              <View style={[styles.glyph, { backgroundColor: a.color }]}><Text style={[styles.glyphText, { color: c.onAccent }]}>{a.glyph}</Text></View>
              <Text style={[type.bodyBold, { color: c.text }]}>{a.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
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

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space.m, marginBottom: space.l },
  action: { flexGrow: 1, flexBasis: '45%', minHeight: 56, borderRadius: 14, padding: space.m, flexDirection: 'row', alignItems: 'center', gap: space.m },
  glyph: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  glyphText: { fontSize: 18, fontWeight: '700' },
});

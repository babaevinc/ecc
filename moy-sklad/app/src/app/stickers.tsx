import { Stack } from 'expo-router';
import { create as createQr } from 'qrcode/lib/core/qrcode';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { isPrintCancelled, printLabels } from '@/components/print';
import { QrCode } from '@/components/qr-code';
import { RequireSession } from '@/components/require-session';
import { useToast } from '@/components/toast';
import { Group, Message, PrimaryButton, Row, Screen, Segmented, SmallButton, Stepper } from '@/components/ui';
import { clampCopies, LABEL_SIZE_MM, labelsCount, labelsHtml, MAX_TOTAL, type LabelInfo, type LabelJob } from '@/domain/label';
import { batchLabel, productLabel } from '@/domain/scan';
import { ageDays, formatQty, todayIso } from '@/domain/stock';
import { useStockData } from '@/state/use-stock-data';
import { space, type, usePalette } from '@/theme';

export default function StickersRoute() {
  return (
    <RequireSession>
      <Stack.Screen options={{ headerShown: true, title: 'Стикеры', headerBackTitle: 'Назад' }} />
      <StickersScreen />
    </RequireSession>
  );
}

type Kind = 'products' | 'batches';
type Choice = { id: string; title: string; subtitle: string; info: LabelInfo };

const shortDate = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
const QR_PREVIEW = 140;

function StickersScreen() {
  const c = usePalette();
  const toast = useToast();
  const { data, error, loading, reload } = useStockData();
  const [kind, setKind] = useState<Kind>('products');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [copies, setCopies] = useState('1');
  const [busy, setBusy] = useState(false);

  const today = todayIso();
  const products = data?.products ?? [];
  const choices: Choice[] = kind === 'products'
    ? products.map(p => ({
      id: p.id, title: p.name, subtitle: p.unit === 'kg' ? 'в килограммах' : 'в коробках',
      info: { code: productLabel(p.id), product: p.name, qty: null, receivedOn: null, warehouse: null, supplier: null, note: p.unit === 'kg' ? 'Считаем в килограммах' : 'Считаем в коробках' },
    }))
    : (data?.batches ?? [])
      .filter(b => b.leftQty > 0 && products.some(p => p.id === b.productId))
      .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn))
      .map(b => {
        const p = products.find(x => x.id === b.productId)!;
        const warehouse = data?.warehouses.find(w => w.id === b.warehouseId)?.name ?? '';
        return {
          id: b.id, title: p.name, subtitle: `${warehouse} · приход ${shortDate(b.receivedOn)} · ${ageDays(b.receivedOn, today)} дн. · ${formatQty(b.leftQty, p.unit)}`,
          info: { code: batchLabel(b.id), product: p.name, qty: formatQty(b.leftQty, p.unit), receivedOn: b.receivedOn, warehouse, supplier: b.supplier },
        };
      });

  const chosen = choices.filter(ch => picked.has(ch.id));
  const each = clampCopies(Number(copies));
  const total = chosen.length * each;
  const first = chosen[0] ?? null;

  function toggle(id: string) {
    setPicked(cur => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function switchKind(next: string) {
    setKind(next as Kind);
    setPicked(new Set());
  }

  async function handlePrint() {
    if (!chosen.length) return toast('error', kind === 'products' ? 'Отметьте зелень, на которую нужны стикеры' : 'Отметьте партии, на которые нужны стикеры');
    if (total > MAX_TOTAL) return toast('error', `За один раз — не больше ${MAX_TOTAL} стикеров. Сейчас выбрано ${total}`);
    const jobs: LabelJob[] = chosen.map(ch => ({ info: ch.info, qr: createQr(ch.info.code, { errorCorrectionLevel: 'M' }).modules, copies: each }));
    setBusy(true);
    try {
      await printLabels(labelsHtml(jobs));
      toast('success', `Отправлено на печать: ${labelsCount(total)}`);
    } catch (e) {
      if (!isPrintCancelled(e)) toast('error', 'Не удалось открыть печать. Проверьте, что принтер включён и доступен');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      {error ? <Message tone="error" text={error} /> : null}
      <Segmented value={kind} onChange={switchKind} options={[{ value: 'products', label: 'На товары' }, { value: 'batches', label: 'На партии' }]} />
      <Message tone="info" text={kind === 'products'
        ? 'Стикер товара — для коробок и полок без штрихкода поставщика. Сканер по нему находит зелень, чтобы принять или продать.'
        : 'Стикер партии показывает дату прихода. Сканер по нему находит именно эту партию и её остаток.'} />

      {first ? (
        <View style={styles.preview}>
          <QrCode matrix={createQr(first.info.code, { errorCorrectionLevel: 'M' }).modules} size={QR_PREVIEW} label={`QR-код стикера: ${first.title}`} />
          <Text style={[type.bodyBold, { color: c.text }]}>{first.title}</Text>
          {chosen.length > 1 ? <Text style={[type.footnote, { color: c.secondary }]}>и ещё {chosen.length - 1}</Text> : null}
        </View>
      ) : null}

      <Group title={kind === 'products' ? 'Зелень' : 'Партии на остатке'}>
        {choices.length ? choices.map((ch, i) => (
          <Row key={ch.id} title={ch.title} subtitle={ch.subtitle} selected={picked.has(ch.id)} last={i === choices.length - 1} onPress={() => toggle(ch.id)} />
        )) : <Row title={kind === 'products' ? 'Товаров пока нет' : 'На остатке ничего нет'} last />}
      </Group>
      {choices.length > 1 ? (
        <View style={styles.all}>
          <SmallButton title={chosen.length === choices.length ? 'Снять все' : 'Выбрать все'}
            onPress={() => setPicked(chosen.length === choices.length ? new Set() : new Set(choices.map(ch => ch.id)))} />
        </View>
      ) : null}

      <Group title="Копий каждого стикера">
        <Stepper value={copies} onChange={setCopies} unit="box" label="Копий каждого стикера" placeholder="Копий" />
      </Group>
      <Text style={[type.footnote, { color: c.secondary }]}>
        Размер {LABEL_SIZE_MM.width}×{LABEL_SIZE_MM.height} мм — для термопринтера этикеток; на обычном принтере стикер печатается в углу листа.
      </Text>
      <PrimaryButton title={total ? `Печатать ${labelsCount(Math.min(total, MAX_TOTAL))}` : 'Печатать стикеры'} onPress={handlePrint} busy={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', gap: space.s, marginBottom: space.l },
  all: { alignItems: 'flex-start', marginTop: -space.m, marginBottom: space.l },
});

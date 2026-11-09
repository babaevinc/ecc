import { Stack, useLocalSearchParams } from 'expo-router';
import { create as createQr } from 'qrcode/lib/core/qrcode';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { isPrintCancelled, printLabels } from '@/components/print';
import { QrCode } from '@/components/qr-code';
import { RequireSession } from '@/components/require-session';
import { Group, Message, PrimaryButton, Row, Screen, Stepper } from '@/components/ui';
import { clampCopies, LABEL_SIZE_MM, labelHtml, labelsCount, type LabelInfo } from '@/domain/label';
import { batchLabel } from '@/domain/scan';
import { formatQty, type StockBatch } from '@/domain/stock';
import { useApi } from '@/state/session';
import { userMessage, useStockData } from '@/state/use-stock-data';
import { space, type, usePalette } from '@/theme';

export default function LabelRoute() {
  return (
    <RequireSession>
      <Stack.Screen options={{ headerShown: true, title: 'Этикетка партии', headerBackTitle: 'Назад' }} />
      <LabelScreen />
    </RequireSession>
  );
}

const ruDate = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const QR_PREVIEW = 200;

function LabelScreen() {
  const api = useApi();
  const c = usePalette();
  const { data } = useStockData();
  const params = useLocalSearchParams<{ batch?: string }>();
  const batchId = typeof params.batch === 'string' ? params.batch : '';
  const [batch, setBatch] = useState<StockBatch | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copies, setCopies] = useState('1');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    // Only batches the server returns for this company get a label: the id from the URL is not trusted.
    api.getBatch(batchId)
      .then(b => { if (active) { setBatch(b); setLoadError(b ? null : 'Партия не найдена или уже закончилась'); } })
      .catch(e => { if (active) setLoadError(userMessage(e)); });
    return () => { active = false; };
  }, [api, batchId]);

  const product = data?.products.find(p => p.id === batch?.productId) ?? null;
  const warehouse = data?.warehouses.find(w => w.id === batch?.warehouseId)?.name ?? '';
  const code = batch ? batchLabel(batch.id) : '';
  const matrix = useMemo(() => (code ? createQr(code, { errorCorrectionLevel: 'M' }).modules : null), [code]);
  const count = clampCopies(Number(copies));

  async function handlePrint() {
    if (!batch || !product || !matrix) return;
    const info: LabelInfo = {
      code, product: product.name, qty: formatQty(batch.leftQty, product.unit),
      receivedOn: batch.receivedOn, warehouse, supplier: batch.supplier,
    };
    setBusy(true);
    setNotice(null);
    try {
      await printLabels(labelHtml(info, matrix, count));
      setNotice({ tone: 'success', text: `Отправлено на печать: ${labelsCount(count)}` });
    } catch (e) {
      if (!isPrintCancelled(e)) setNotice({ tone: 'error', text: 'Не удалось открыть печать. Проверьте, что принтер включён и доступен.' });
    } finally {
      setBusy(false);
    }
  }

  if (loadError) return <Screen><Message tone="error" text={loadError} /></Screen>;
  if (!batch || !product || !matrix) return <Screen><Message tone="info" text="Загружаем партию…" /></Screen>;

  return (
    <Screen>
      <View style={styles.preview}>
        <QrCode matrix={matrix} size={QR_PREVIEW} label={`QR-код партии: ${product.name}`} />
        <Text style={[type.title, { color: c.text }]}>{product.name}</Text>
        <Text style={[type.footnote, { color: c.secondary }]}>{code.slice(5, 13)}</Text>
      </View>

      <Group title="На этикетке">
        <Row title="Остаток" value={formatQty(batch.leftQty, product.unit)} />
        <Row title="Приход" value={ruDate(batch.receivedOn)} />
        <Row title="Склад" value={warehouse || '—'} last={!batch.supplier} />
        {batch.supplier ? <Row title="Поставщик" value={batch.supplier} last /> : null}
      </Group>

      <Group title="Сколько этикеток">
        <Stepper value={copies} onChange={setCopies} unit="box" label="Количество этикеток" placeholder="Этикеток" />
      </Group>
      <Text style={[type.footnote, { color: c.secondary }]}>
        Размер {LABEL_SIZE_MM.width}×{LABEL_SIZE_MM.height} мм — для термопринтера этикеток. Подойдёт и обычный принтер: этикетка
        напечатается в углу листа. Наклейте её на коробку — потом партию можно найти сканером.
      </Text>
      <PrimaryButton title={`Печатать ${labelsCount(count)}`} onPress={handlePrint} busy={busy} />
      {notice ? <Message tone={notice.tone} text={notice.text} /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { alignItems: 'center', gap: space.s, marginBottom: space.xl },
});

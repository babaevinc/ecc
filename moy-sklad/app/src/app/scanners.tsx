import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';

import type { Scanner } from '@/api/types';
import { RequireSession } from '@/components/require-session';
import { ScanField } from '@/components/scan-field';
import { Field, Group, Message, PrimaryButton, Row, Screen, Segmented } from '@/components/ui';
import { cleanScan, parseScan, SCANNER_KINDS, type ScannerKind } from '@/domain/scan';
import { useApi } from '@/state/session';
import { userMessage, useStockData } from '@/state/use-stock-data';
import { type, usePalette } from '@/theme';

const ANY_WAREHOUSE = '';

export default function ScannersRoute() {
  return (
    <RequireSession>
      <Stack.Screen options={{ headerShown: true, title: 'Сканеры', headerBackTitle: 'Назад' }} />
      <ScannersScreen />
    </RequireSession>
  );
}

const when = (iso: string): string => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function ScannersScreen() {
  const api = useApi();
  const c = usePalette();
  const { data } = useStockData();
  const [list, setList] = useState<Scanner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<ScannerKind>('keyboard');
  const [prefix, setPrefix] = useState('');
  const [suffix, setSuffix] = useState('');
  const [warehouseId, setWarehouseId] = useState(ANY_WAREHOUSE);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setList(await api.listScanners());
      setError(null);
    } catch (e) {
      setError(userMessage(e));
    }
  }, [api]);
  useEffect(() => { reload(); }, [reload]);

  const warehouses = data?.warehouses ?? [];
  const kindLabel = (k: ScannerKind) => SCANNER_KINDS.find(x => x.value === k)?.label ?? k;
  const hardware = list.filter(s => s.kind !== 'camera');
  const tested = hardware.find(s => s.id === testId) ?? hardware[0] ?? null;

  async function handleAdd() {
    if (!name.trim()) {
      setNotice({ tone: 'error', text: 'Введите название, например «Сканер склада 1»' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await api.addScanner({ name, kind, prefix, suffix, warehouseId: warehouseId || null });
      setNotice({ tone: 'success', text: `Сканер «${name.trim()}» добавлен. Проверьте его ниже.` });
      setName('');
      setPrefix('');
      setSuffix('');
      await reload();
    } catch (e) {
      setNotice({ tone: 'error', text: userMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    setConfirmDelete(null);
    try {
      await api.removeScanner(id);
      await reload();
    } catch (e) {
      setNotice({ tone: 'error', text: userMessage(e) });
    }
  }

  async function handleTest(raw: string) {
    if (!tested) return;
    const code = cleanScan(raw, tested);
    const parsed = parseScan(raw, tested);
    const what = parsed.kind === 'batch' ? 'этикетка партии' : parsed.kind === 'barcode' ? `штрихкод (${parsed.format === 'other' ? 'другой формат' : parsed.format.toUpperCase()})` : parsed.reason;
    setTestResult(`«${code}» — ${what}`);
    if (parsed.kind !== 'invalid') {
      await api.markScannerSeen(tested.id).catch(() => undefined);
      await reload();
    }
  }

  return (
    <Screen>
      {error ? <Message tone="error" text={error} /> : null}

      <Group title="Подключённые сканеры">
        {list.length ? list.map((s, i) => (
          <Row key={s.id} title={s.name} last={i === list.length - 1}
            subtitle={[kindLabel(s.kind), warehouses.find(w => w.id === s.warehouseId)?.name, s.lastSeenAt ? `проверен ${when(s.lastSeenAt)}` : 'ещё не проверен'].filter(Boolean).join(' · ')}
            value={confirmDelete === s.id ? 'Точно удалить?' : 'Удалить'} onPress={() => handleDelete(s.id)} />
        )) : <Row title="Пока нет — добавьте первый сканер ниже" last />}
      </Group>

      <Group title="Новый сканер">
        <Field value={name} onChangeText={setName} placeholder="Название, например «Сканер склада 1»" accessibilityLabel="Название сканера" style={{ marginBottom: 0 }} />
      </Group>
      <Segmented value={kind} onChange={v => setKind(v as ScannerKind)} options={SCANNER_KINDS.map(k => ({ value: k.value, label: k.label }))} />
      <Message tone="info" text={SCANNER_KINDS.find(k => k.value === kind)?.hint ?? ''} />
      {kind !== 'camera' ? (
        <>
          <Field value={prefix} onChangeText={setPrefix} placeholder="Префикс (необязательно)" autoCapitalize="none" accessibilityLabel="Префикс" />
          <Field value={suffix} onChangeText={setSuffix} placeholder="Суффикс (необязательно)" autoCapitalize="none" accessibilityLabel="Суффикс" />
          <Text style={[type.footnote, { color: c.secondary }]}>Префикс и суффикс — символы, которые сканер добавляет до и после кода; приложение их отрежет. После кода сканер должен отправлять Enter (CR) — это стандартная настройка большинства моделей.</Text>
        </>
      ) : null}
      {warehouses.length ? (
        <Segmented value={warehouseId} onChange={setWarehouseId}
          options={[{ value: ANY_WAREHOUSE, label: 'Любой склад' }, ...warehouses.map(w => ({ value: w.id, label: w.name }))]} />
      ) : null}
      <PrimaryButton title="Добавить сканер" onPress={handleAdd} busy={busy} />
      {notice ? <Message tone={notice.tone} text={notice.text} /> : null}

      {hardware.length ? (
        <Group title="Проверка сканера">
          <Segmented value={tested?.id ?? ''} onChange={setTestId} options={hardware.map(s => ({ value: s.id, label: s.name }))} />
          <ScanField onScan={handleTest} placeholder="Отсканируйте любую этикетку" />
          {testResult ? <Message tone="success" text={testResult} /> : null}
        </Group>
      ) : null}

      <Text style={[type.footnote, { color: c.secondary }]}>Добавлять и удалять сканеры может владелец компании.</Text>
    </Screen>
  );
}

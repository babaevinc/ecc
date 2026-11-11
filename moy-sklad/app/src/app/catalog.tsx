import { Stack } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { ApiError, type Barcode } from '@/api/types';
import { NamedList, type NamedItem } from '@/components/catalog/named-list';
import { RequireSession } from '@/components/require-session';
import { useToast } from '@/components/toast';
import { Group, Message, Row, Screen } from '@/components/ui';
import { KIND_OPTIONS, UNIT_OPTIONS } from '@/domain/catalog';
import { formatQty, type Product, type StockBatch, type Unit, type Warehouse } from '@/domain/stock';
import { useApi } from '@/state/session';
import { useAccess } from '@/state/use-access';
import { userMessage } from '@/state/use-stock-data';

export default function CatalogRoute() {
  return (
    <RequireSession>
      <Stack.Screen options={{ headerShown: true, title: 'Товары и склады', headerBackTitle: 'Назад' }} />
      <CatalogScreen />
    </RequireSession>
  );
}

type Catalog = { products: Product[]; warehouses: Warehouse[]; batches: StockBatch[]; barcodes: Barcode[] };

function CatalogScreen() {
  const api = useApi();
  const toast = useToast();
  const { role, loaded } = useAccess();
  const [data, setData] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [products, warehouses, batches, barcodes] = await Promise.all([api.listProducts(), api.listWarehouses(), api.listStock(), api.listBarcodes()]);
      setData({ products, warehouses, batches, barcodes });
      setError(null);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => { reload(); }, [reload]);

  if (loaded && role !== 'owner') {
    return <Screen><Message tone="info" text="Ассортимент и склады меняет владелец компании." /></Screen>;
  }
  if (!data) return <Screen>{error ? <Message tone="error" text={error} /> : <Message tone="info" text="Загрузка…" />}</Screen>;

  const stockOf = (match: (b: StockBatch) => boolean) => data.batches.filter(b => match(b) && b.leftQty > 0).reduce((sum, b) => sum + b.leftQty, 0);
  const after = async (action: Promise<unknown>): Promise<void> => { await action; await reload(); };

  const products: NamedItem[] = data.products.map(p => {
    const left = stockOf(b => b.productId === p.id);
    return { id: p.id, name: p.name, archived: p.archived, option: p.unit, note: left > 0 ? `на остатке ${formatQty(left, p.unit)}` : undefined };
  });
  const warehouses: NamedItem[] = data.warehouses.map(w => {
    const lots = data.batches.filter(b => b.warehouseId === w.id && b.leftQty > 0).length;
    return { id: w.id, name: w.name, archived: w.archived, option: w.kind, note: lots ? `партий на остатке: ${lots}` : undefined };
  });
  const hasStock = (item: NamedItem) => !!item.note;
  const activeWarehouses = data.warehouses.filter(w => !w.archived).length;
  // Clear words before the server is asked; the server enforces the same rules (catalog_guards.sql).
  const keepOneWarehouse = (item: NamedItem) => {
    if (!item.archived && activeWarehouses <= 1) throw new ApiError('Нужен хотя бы один склад — сначала добавьте другой');
  };

  async function handleUnlink(code: string) {
    if (confirm !== code) return setConfirm(code);
    setConfirm(null);
    try {
      await api.unlinkBarcode(code);
      toast('success', 'Штрихкод отвязан');
      await reload();
    } catch (e) {
      toast('error', userMessage(e));
    }
  }

  return (
    <Screen refreshing={loading} onRefresh={reload}>
      {error ? <Message tone="error" text={error} /> : null}
      <NamedList title="Ассортимент" items={products} options={UNIT_OPTIONS} addPlaceholder="Название новой зелени" addTitle="Добавить зелень"
        emptyText="Пока пусто — добавьте первую зелень ниже"
        optionLocked={item => (data.batches.some(b => b.productId === item.id) ? 'Единицу нельзя менять: по этой зелени уже есть партии. Заведите отдельную позицию, например «Укроп, кг».' : null)}
        onAdd={(name, unit) => after(api.addProduct({ name, unit: unit as Unit }))}
        onSave={(item, name, unit) => after(api.updateProduct(item.id, { name, unit: unit as Unit }))}
        onArchive={async (item, archived) => {
          if (archived && hasStock(item)) throw new ApiError(`Сначала продайте или спишите остаток: ${item.note?.replace('на остатке ', '')}`);
          await after(api.updateProduct(item.id, { archived }));
        }}
        onDelete={item => after(api.deleteProduct(item.id))} />

      <NamedList title="Склады и точки" items={warehouses} options={KIND_OPTIONS} addPlaceholder="Название склада или точки" addTitle="Добавить склад"
        emptyText="Складов нет — добавьте первый ниже"
        onAdd={(name, kind) => after(api.addWarehouse({ name, kind: kind as Warehouse['kind'] }))}
        onSave={(item, name, kind) => after(api.updateWarehouse(item.id, { name, kind: kind as Warehouse['kind'] }))}
        onArchive={async (item, archived) => {
          if (archived) {
            keepOneWarehouse(item);
            if (hasStock(item)) throw new ApiError('На складе ещё есть товар: сначала продайте, переместите или спишите остаток');
          }
          await after(api.updateWarehouse(item.id, { archived }));
        }}
        onDelete={async item => {
          keepOneWarehouse(item);
          await after(api.deleteWarehouse(item.id));
        }} />

      <Group title="Штрихкоды поставщиков">
        {data.barcodes.length ? data.barcodes.map((b, i) => (
          <Row key={b.code} title={data.products.find(p => p.id === b.productId)?.name ?? 'Товар'} subtitle={b.code} last={i === data.barcodes.length - 1}
            value={confirm === b.code ? 'Точно отвязать?' : 'Отвязать'} onPress={() => handleUnlink(b.code)} />
        )) : <Row title="Пока нет. Отсканируйте штрихкод поставщика и выберите зелень" last />}
      </Group>
      <Message tone="info" text="Удалить можно только то, по чему не было операций. Остальное отправляйте в архив: история сохранится, а в списках позиция исчезнет." />
    </Screen>
  );
}

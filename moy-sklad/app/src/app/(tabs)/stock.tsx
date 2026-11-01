import { Group, Message, Row, Screen } from '@/components/ui';
import { ageDays, formatQty, todayIso, WARN_DAYS } from '@/domain/stock';
import { useStockData } from '@/state/use-stock-data';

const shortDate = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

export default function StockScreen() {
  const { data, error, loading, reload } = useStockData();
  const today = todayIso();
  const productById = new Map((data?.products ?? []).map(p => [p.id, p]));

  return (
    <Screen title="Склады" refreshing={loading} onRefresh={reload}>
      {error ? <Message tone="error" text={error} /> : null}
      {(data?.warehouses ?? []).map(w => {
        const batches = (data?.batches ?? [])
          .filter(b => b.warehouseId === w.id && b.leftQty > 0 && productById.has(b.productId))
          .sort((a, b) => a.receivedOn.localeCompare(b.receivedOn));
        return (
          <Group key={w.id} title={w.name}>
            {batches.length ? batches.map((b, i) => {
              const p = productById.get(b.productId)!;
              const age = ageDays(b.receivedOn, today);
              return (
                <Row key={b.id} title={p.name} value={formatQty(b.leftQty, p.unit)} last={i === batches.length - 1}
                  subtitle={`партия ${shortDate(b.receivedOn)} · ${age} дн.${b.supplier ? ` · ${b.supplier}` : ''}`}
                  tone={age >= WARN_DAYS ? 'warning' : 'normal'} />
              );
            }) : <Row title="Пусто" last />}
          </Group>
        );
      })}
    </Screen>
  );
}

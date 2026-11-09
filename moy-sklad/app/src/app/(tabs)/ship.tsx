import { useState } from 'react';

import { RequestsPanel } from '@/components/ops/requests-panel';
import { SalePanel } from '@/components/ops/sale-panel';
import { SpoilPanel } from '@/components/ops/spoil-panel';
import { Message, Screen, Segmented } from '@/components/ui';
import { availableQty } from '@/domain/fifo';
import { can } from '@/domain/ops';
import { allowedWarehouses, useAccess } from '@/state/use-access';
import { useStockData } from '@/state/use-stock-data';

type Mode = 'requests' | 'sale' | 'spoil';

export default function ShipScreen() {
  const { data, error, loading, reload } = useStockData();
  const { access, role, loaded } = useAccess();
  const [mode, setMode] = useState<Mode>('requests');
  const [picked, setPicked] = useState<string | null>(null);

  const warehouses = data ? allowedWarehouses(data.warehouses, access) : [];
  const warehouseId = picked && warehouses.some(w => w.id === picked) ? picked : warehouses[0]?.id ?? null;
  const stockIn = (wh: string, pid: string) => availableQty(data?.batches ?? [], wh, pid);
  const available = (pid: string) => (warehouseId ? stockIn(warehouseId, pid) : 0);
  const modes = [
    { value: 'requests', label: 'Заявки' },
    ...(can.sell(role) ? [{ value: 'sale', label: 'Продажа' }] : []),
    ...(can.writeOff(role) ? [{ value: 'spoil', label: 'Порча' }] : []),
  ];
  const active: Mode = modes.some(m => m.value === mode) ? mode : 'requests';

  return (
    <Screen title="Отгрузка" refreshing={loading} onRefresh={reload}>
      {error ? <Message tone="error" text={error} /> : null}
      {loaded && !role ? <Message tone="error" text="Вы не состоите в компании. Попросите владельца добавить вас" /> : null}
      {modes.length > 1 ? <Segmented value={active} onChange={v => setMode(v as Mode)} options={modes} /> : null}
      {warehouses.length > 1 ? (
        <Segmented value={warehouseId ?? ''} onChange={setPicked} options={warehouses.map(w => ({ value: w.id, label: w.name }))} />
      ) : null}
      {data && warehouseId ? (() => {
        const panel = { data, warehouseId, warehouses, role, available, onChanged: reload };
        if (active === 'sale') return <SalePanel {...panel} />;
        if (active === 'spoil') return <SpoilPanel {...panel} />;
        return <RequestsPanel {...panel} stockIn={stockIn} />;
      })() : null}
      {data && !warehouseId ? <Message tone="info" text="Нет доступных складов" /> : null}
    </Screen>
  );
}

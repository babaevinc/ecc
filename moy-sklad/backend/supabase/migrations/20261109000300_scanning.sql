-- «Мой склад» — label scanning: supplier barcodes linked to products, and the scanners a company uses.
-- Our own batch labels carry a QR "MS:B:<batch uuid>" and need no table: the app looks the batch up directly.

-- camera   — phone camera in the app
-- keyboard — Bluetooth/USB scanner in keyboard mode (types the code and presses Enter)
-- terminal — Android warehouse terminal with a built-in scanner (keyboard wedge)
create type public.scanner_kind as enum ('camera', 'keyboard', 'terminal');

create table public.product_barcodes (
  company_id uuid not null references public.companies (id) on delete cascade,
  code text not null check (code ~ '^[0-9A-Za-z./:+-]{4,64}$'),
  product_id uuid not null references public.products (id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  primary key (company_id, code)
);
create index product_barcodes_product_idx on public.product_barcodes (product_id);

create table public.scanners (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 60),
  kind public.scanner_kind not null,
  prefix text not null default '' check (length(prefix) <= 10),
  suffix text not null default '' check (length(suffix) <= 10),
  warehouse_id uuid references public.warehouses (id) on delete set null,
  created_by uuid not null default auth.uid() references auth.users (id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique (company_id, name)
);

alter table public.product_barcodes enable row level security;
alter table public.scanners enable row level security;

create policy product_barcodes_read on public.product_barcodes for select to authenticated using (public.can_read(company_id));
-- Owner and staff link a supplier barcode while receiving; the product must belong to the same company.
create policy product_barcodes_link on public.product_barcodes for insert to authenticated
  with check (
    public.my_role(company_id) in ('owner', 'staff') and created_by = auth.uid()
    and exists (select 1 from public.products p where p.id = product_id and p.company_id = product_barcodes.company_id)
  );
create policy product_barcodes_unlink on public.product_barcodes for delete to authenticated
  using (public.my_role(company_id) = 'owner');

create policy scanners_read on public.scanners for select to authenticated using (public.can_read(company_id));
-- Only the owner registers, renames and removes scanners; a warehouse must belong to the same company.
create policy scanners_owner on public.scanners for all to authenticated
  using (public.my_role(company_id) = 'owner')
  with check (
    public.my_role(company_id) = 'owner'
    and (warehouse_id is null or exists (select 1 from public.warehouses w where w.id = warehouse_id and w.company_id = scanners.company_id))
  );

-- Any member who tests a scanner may record that it was seen working.
create function public.mark_scanner_seen(p_scanner uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.scanners where id = p_scanner;
  if v_company is null or public.my_role(v_company) is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  update public.scanners set last_seen_at = now() where id = p_scanner;
end
$$;

revoke all on public.product_barcodes, public.scanners from anon, authenticated;
grant select, insert, delete on public.product_barcodes to authenticated;
grant select, insert, delete on public.scanners to authenticated;
grant update (name, kind, prefix, suffix, warehouse_id) on public.scanners to authenticated;
revoke execute on function public.mark_scanner_seen(uuid) from public, anon;
grant execute on function public.mark_scanner_seen(uuid) to authenticated;

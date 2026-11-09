-- «Мой склад» — schema, row level security and stock functions.
-- Target: Supabase (provides the auth schema, auth.uid() and the anon/authenticated roles).
-- Stock is never stored: left = batch.qty − live movements. Clients read through RLS and change
-- stock only through the SECURITY DEFINER functions at the end of this file.

create extension if not exists pgcrypto;

-- ── Types ──────────────────────────────────────────────────────────────────────────────
create type public.member_role as enum ('owner', 'staff', 'manager', 'viewer');
create type public.warehouse_kind as enum ('warehouse', 'market_point');
create type public.product_unit as enum ('box', 'kg');
create type public.batch_kind as enum ('receipt', 'move_in', 'surplus');
create type public.movement_kind as enum ('ship', 'sale', 'move_out', 'shortage', 'waste');
create type public.request_status as enum ('new', 'in_progress', 'done', 'cancelled');
create type public.waste_reason as enum ('spoiled', 'wilted', 'defect', 'transport', 'other');
create type public.count_status as enum ('pending', 'applied', 'rejected');

-- ── Tables ─────────────────────────────────────────────────────────────────────────────
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  blocked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.members (
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.member_role not null,
  warehouse_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index members_user_idx on public.members (user_id);

create table public.warehouses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  kind public.warehouse_kind not null default 'warehouse',
  archived boolean not null default false,
  unique (company_id, name)
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  unit public.product_unit not null default 'box',
  sort_order integer,
  archived boolean not null default false,
  unique (company_id, name)
);

create table public.batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id),
  product_id uuid not null references public.products (id),
  qty numeric(12, 3) not null check (qty > 0),
  received_on date not null,
  supplier text check (length(supplier) <= 120),
  unit_cost numeric(12, 2) check (unit_cost >= 0),
  source_batch_id uuid references public.batches (id),
  kind public.batch_kind not null default 'receipt',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index batches_stock_idx on public.batches (company_id, warehouse_id, product_id, received_on, created_at);
create index batches_age_idx on public.batches (company_id, received_on);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  number integer not null,
  warehouse_id uuid not null references public.warehouses (id),
  client text check (length(client) <= 120),
  status public.request_status not null default 'new',
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  status_by uuid references auth.users (id),
  status_at timestamptz,
  unique (company_id, number)
);
create index requests_active_idx on public.requests (company_id, status, created_at desc);

create table public.request_lines (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests (id) on delete cascade,
  product_id uuid not null references public.products (id),
  qty numeric(12, 3) not null check (qty > 0),
  batch_id uuid references public.batches (id),
  price numeric(12, 2) check (price >= 0)
);
create index request_lines_request_idx on public.request_lines (request_id);

create table public.movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  batch_id uuid not null references public.batches (id),
  qty numeric(12, 3) not null check (qty > 0),
  kind public.movement_kind not null,
  price numeric(12, 2) check (price >= 0),
  markdown boolean not null default false,
  reason public.waste_reason,
  note text check (length(note) <= 500),
  request_id uuid references public.requests (id),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users (id),
  check (kind <> 'waste' or reason is not null)
);
create index movements_live_idx on public.movements (batch_id) where voided_at is null;

create table public.stock_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id),
  lines jsonb not null,
  status public.count_status not null default 'pending',
  reason text check (length(reason) <= 500),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  status_by uuid references auth.users (id),
  status_at timestamptz
);

create table public.daily_prices (
  company_id uuid not null references public.companies (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  price_date date not null,
  price numeric(12, 2) not null check (price > 0),
  primary key (company_id, product_id, price_date)
);

create table public.push_tokens (
  user_id uuid not null references auth.users (id) on delete cascade,
  token text not null check (length(token) <= 255),
  platform text not null check (platform in ('ios', 'android')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index notifications_inbox_idx on public.notifications (user_id, created_at desc);

create table public.audit_log (
  id bigint generated always as identity primary key,
  company_id uuid not null,
  actor uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  at timestamptz not null default now()
);
create index audit_log_company_idx on public.audit_log (company_id, at desc);

-- ── Access helpers ─────────────────────────────────────────────────────────────────────
create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create function public.my_role(p_company uuid) returns public.member_role
language sql stable security definer set search_path = public, pg_temp as $$
  select m.role from public.members m join public.companies c on c.id = m.company_id
  where m.company_id = p_company and m.user_id = auth.uid() and c.blocked_at is null
$$;

create function public.can_read(p_company uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select public.is_platform_admin() or public.my_role(p_company) is not null
$$;

create function public.can_use_warehouse(p_company uuid, p_warehouse uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from public.members m
    where m.company_id = p_company and m.user_id = auth.uid()
      and (m.role = 'owner' or cardinality(m.warehouse_ids) = 0 or p_warehouse = any (m.warehouse_ids))
  )
$$;

-- Not found for strangers (they must not learn the object exists), forbidden for the wrong role.
create function public.require_role(p_company uuid, p_roles public.member_role[]) returns public.member_role
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_role public.member_role := public.my_role(p_company);
begin
  if p_company is null or (v_role is null and not public.is_platform_admin()) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v_role is null or not (v_role = any (p_roles)) then
    raise exception 'not allowed for your role' using errcode = '42501';
  end if;
  return v_role;
end
$$;

-- ── Stock view (RLS of the reader applies) ─────────────────────────────────────────────
create view public.stock_batches with (security_invoker = true) as
select b.id, b.company_id, b.warehouse_id, b.product_id, b.received_on, b.supplier, b.kind, b.qty,
       b.qty - coalesce((select sum(m.qty) from public.movements m where m.batch_id = b.id and m.voided_at is null), 0) as left_qty
from public.batches b;

-- ── Row level security ─────────────────────────────────────────────────────────────────
alter table public.companies enable row level security;
alter table public.platform_admins enable row level security;
alter table public.members enable row level security;
alter table public.warehouses enable row level security;
alter table public.products enable row level security;
alter table public.batches enable row level security;
alter table public.requests enable row level security;
alter table public.request_lines enable row level security;
alter table public.movements enable row level security;
alter table public.stock_counts enable row level security;
alter table public.daily_prices enable row level security;
alter table public.push_tokens enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;

create policy companies_read on public.companies for select to authenticated using (public.can_read(id));
create policy companies_admin on public.companies for all to authenticated
  using (public.is_platform_admin()) with check (public.is_platform_admin());

create policy platform_admins_self on public.platform_admins for select to authenticated using (user_id = auth.uid());

create policy members_read on public.members for select to authenticated using (public.can_read(company_id));
create policy members_owner on public.members for all to authenticated
  using (public.is_platform_admin() or public.my_role(company_id) = 'owner')
  with check (public.is_platform_admin() or public.my_role(company_id) = 'owner');

create policy warehouses_read on public.warehouses for select to authenticated using (public.can_read(company_id));
create policy warehouses_owner on public.warehouses for all to authenticated
  using (public.my_role(company_id) = 'owner') with check (public.my_role(company_id) = 'owner');

create policy products_read on public.products for select to authenticated using (public.can_read(company_id));
create policy products_owner on public.products for all to authenticated
  using (public.my_role(company_id) = 'owner') with check (public.my_role(company_id) = 'owner');

-- Stock tables are read-only for clients; writes go through the functions below.
create policy batches_read on public.batches for select to authenticated using (public.can_read(company_id));
create policy movements_read on public.movements for select to authenticated using (public.can_read(company_id));
create policy requests_read on public.requests for select to authenticated using (public.can_read(company_id));
create policy request_lines_read on public.request_lines for select to authenticated
  using (exists (select 1 from public.requests r where r.id = request_id and public.can_read(r.company_id)));
create policy stock_counts_read on public.stock_counts for select to authenticated using (public.can_read(company_id));

create policy daily_prices_read on public.daily_prices for select to authenticated using (public.can_read(company_id));
create policy daily_prices_write on public.daily_prices for all to authenticated
  using (public.my_role(company_id) in ('owner', 'staff')) with check (public.my_role(company_id) in ('owner', 'staff'));

create policy push_tokens_own on public.push_tokens for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy notifications_own_read on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_own_mark on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy audit_log_owner on public.audit_log for select to authenticated
  using (public.is_platform_admin() or public.my_role(company_id) = 'owner');

-- ── Privileges (Supabase grants everything to anon/authenticated by default) ───────────
revoke all on all tables in schema public from anon, authenticated;
grant select on public.companies, public.platform_admins, public.members, public.warehouses, public.products,
  public.requests, public.request_lines, public.movements, public.stock_counts, public.daily_prices,
  public.notifications, public.audit_log, public.stock_batches to authenticated;
-- unit_cost (purchase price) is hidden from every client role; owners read it via batch_costs().
grant select (id, company_id, warehouse_id, product_id, qty, received_on, supplier, source_batch_id, kind, created_by, created_at)
  on public.batches to authenticated;
grant insert, update, delete on public.companies, public.members, public.warehouses, public.products, public.daily_prices to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ── Audit trail ────────────────────────────────────────────────────────────────────────
create function public.audit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_log (company_id, actor, action, entity, entity_id)
  values (new.company_id, auth.uid(), lower(tg_op), tg_table_name, new.id);
  return new;
end
$$;
create trigger batches_audit after insert on public.batches for each row execute function public.audit();
create trigger movements_audit after insert or update on public.movements for each row execute function public.audit();
create trigger requests_audit after insert or update of status on public.requests for each row execute function public.audit();

-- ── Stock functions (the only way to change stock) ─────────────────────────────────────
create function public.batch_costs(p_company uuid) returns table (batch_id uuid, unit_cost numeric)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.require_role(p_company, array['owner']::public.member_role[]);
  return query select b.id, b.unit_cost from public.batches b where b.company_id = p_company;
end
$$;

create function public.receive_stock(
  p_warehouse uuid, p_product uuid, p_qty numeric,
  p_received_on date default current_date, p_supplier text default null, p_unit_cost numeric default null
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_role public.member_role;
  v_id uuid;
begin
  select company_id into v_company from public.warehouses where id = p_warehouse and not archived;
  v_role := public.require_role(v_company, array['owner', 'staff']::public.member_role[]);
  if not public.can_use_warehouse(v_company, p_warehouse) then
    raise exception 'not allowed for this warehouse' using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 or p_qty > 100000 then
    raise exception 'qty must be greater than 0 and at most 100000' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product and company_id = v_company and not archived) then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  insert into public.batches (company_id, warehouse_id, product_id, qty, received_on, supplier, unit_cost, kind, created_by)
  values (v_company, p_warehouse, p_product, p_qty, coalesce(p_received_on, current_date), nullif(btrim(p_supplier), ''),
          case when v_role = 'owner' then p_unit_cost end, 'receipt', auth.uid())
  returning id into v_id;
  return v_id;
end
$$;

create function public.create_request(p_warehouse uuid, p_lines jsonb, p_client text default null) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_role public.member_role;
  v_id uuid;
  v_number integer;
  v_line jsonb;
begin
  select company_id into v_company from public.warehouses where id = p_warehouse and not archived;
  v_role := public.require_role(v_company, array['owner', 'staff', 'manager']::public.member_role[]);
  if v_role = 'staff' and not public.can_use_warehouse(v_company, p_warehouse) then
    raise exception 'not allowed for this warehouse' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'lines must contain 1 to 50 items' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((v_line ->> 'qty')::numeric, 0) <= 0 then
      raise exception 'every line needs a positive qty' using errcode = '22023';
    end if;
    if not exists (select 1 from public.products where id = (v_line ->> 'product_id')::uuid and company_id = v_company) then
      raise exception 'product not found' using errcode = 'P0002';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtextextended(v_company::text, 0));
  select coalesce(max(number), 0) + 1 into v_number from public.requests where company_id = v_company;
  insert into public.requests (company_id, number, warehouse_id, client, created_by)
  values (v_company, v_number, p_warehouse, nullif(btrim(p_client), ''), auth.uid())
  returning id into v_id;
  insert into public.request_lines (request_id, product_id, qty, batch_id, price)
  select v_id, (l ->> 'product_id')::uuid, (l ->> 'qty')::numeric, (l ->> 'batch_id')::uuid, (l ->> 'price')::numeric
  from jsonb_array_elements(p_lines) l;

  -- R12: notify owners and staff of this warehouse, never the author. No prices in the payload.
  insert into public.notifications (company_id, user_id, kind, payload)
  select v_company, m.user_id, 'request_new', jsonb_build_object('request_id', v_id, 'number', v_number, 'warehouse_id', p_warehouse)
  from public.members m
  where m.company_id = v_company and m.user_id <> auth.uid()
    and (m.role = 'owner' or (m.role = 'staff' and (cardinality(m.warehouse_ids) = 0 or p_warehouse = any (m.warehouse_ids))));
  return v_id;
end
$$;

create function public.ship_request(p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.requests%rowtype;
  v_line public.request_lines%rowtype;
  v_batch record;
  v_need numeric;
  v_take numeric;
begin
  select * into v_req from public.requests where id = p_request for update;
  perform public.require_role(v_req.company_id, array['owner', 'staff']::public.member_role[]);
  if not public.can_use_warehouse(v_req.company_id, v_req.warehouse_id) then
    raise exception 'not allowed for this warehouse' using errcode = '42501';
  end if;
  if v_req.status not in ('new', 'in_progress') then
    raise exception 'request is already closed' using errcode = '55000';
  end if;

  for v_line in select * from public.request_lines where request_id = p_request loop
    v_need := v_line.qty;
    -- FIFO: oldest batches first, locked so two storekeepers cannot ship the same box twice.
    for v_batch in
      select b.id, b.qty - coalesce((select sum(m.qty) from public.movements m where m.batch_id = b.id and m.voided_at is null), 0) as left_qty
      from public.batches b
      where b.company_id = v_req.company_id and b.warehouse_id = v_req.warehouse_id and b.product_id = v_line.product_id
        and (v_line.batch_id is null or b.id = v_line.batch_id)
      order by b.received_on, b.created_at
      for update of b
    loop
      exit when v_need <= 0;
      continue when v_batch.left_qty <= 0;
      v_take := least(v_need, v_batch.left_qty);
      insert into public.movements (company_id, batch_id, qty, kind, price, request_id, created_by)
      values (v_req.company_id, v_batch.id, v_take, 'ship', v_line.price, p_request, auth.uid());
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then
      raise exception 'not enough stock: % short', v_need using errcode = '22023';
    end if;
  end loop;

  update public.requests set status = 'done', status_by = auth.uid(), status_at = now() where id = p_request;

  insert into public.notifications (company_id, user_id, kind, payload)
  select v_req.company_id, u, 'request_done', jsonb_build_object('request_id', v_req.id, 'number', v_req.number)
  from (
    select v_req.created_by as u
    union
    select m.user_id from public.members m where m.company_id = v_req.company_id and m.role = 'owner'
  ) recipients
  where u <> auth.uid();
end
$$;

create function public.write_off(p_batch uuid, p_qty numeric, p_reason public.waste_reason, p_note text default null) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_batch public.batches%rowtype;
  v_left numeric;
begin
  select * into v_batch from public.batches where id = p_batch for update;
  perform public.require_role(v_batch.company_id, array['owner', 'staff']::public.member_role[]);
  if not public.can_use_warehouse(v_batch.company_id, v_batch.warehouse_id) then
    raise exception 'not allowed for this warehouse' using errcode = '42501';
  end if;
  select v_batch.qty - coalesce(sum(qty), 0) into v_left from public.movements where batch_id = p_batch and voided_at is null;
  if p_qty is null or p_qty <= 0 or p_qty > v_left then
    raise exception 'qty must be greater than 0 and at most %', v_left using errcode = '22023';
  end if;
  if p_reason is null or (p_reason = 'other' and nullif(btrim(p_note), '') is null) then
    raise exception 'a reason is required; "other" also needs a note' using errcode = '22023';
  end if;
  insert into public.movements (company_id, batch_id, qty, kind, reason, note, created_by)
  values (v_batch.company_id, p_batch, p_qty, 'waste', p_reason, nullif(btrim(p_note), ''), auth.uid());
  return v_left - p_qty;
end
$$;

-- Undo a sale or write-off: the author on the same day, or the owner at any time.
create function public.void_movement(p_movement uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_mov public.movements%rowtype;
  v_role public.member_role;
begin
  select * into v_mov from public.movements where id = p_movement for update;
  v_role := public.require_role(v_mov.company_id, array['owner', 'staff']::public.member_role[]);
  if v_mov.voided_at is not null then
    raise exception 'already cancelled' using errcode = '55000';
  end if;
  if v_mov.kind not in ('sale', 'waste') then
    raise exception 'only sales and write-offs can be cancelled' using errcode = '55000';
  end if;
  if v_role = 'staff' and (v_mov.created_by <> auth.uid() or v_mov.created_at::date <> current_date) then
    raise exception 'only the author on the same day or the owner can cancel' using errcode = '42501';
  end if;
  update public.movements set voided_at = now(), voided_by = auth.uid() where id = p_movement;
end
$$;

-- ── Function privileges ────────────────────────────────────────────────────────────────
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_platform_admin(), public.my_role(uuid), public.can_read(uuid), public.can_use_warehouse(uuid, uuid),
  public.batch_costs(uuid), public.receive_stock(uuid, uuid, numeric, date, text, numeric),
  public.create_request(uuid, jsonb, text), public.ship_request(uuid),
  public.write_off(uuid, numeric, public.waste_reason, text), public.void_movement(uuid)
to authenticated;

-- «Мой склад» — remaining stock operations: request workflow, sales, moves, stock counts,
-- stale-batch notifications (requirements R6–R9, R12).

alter table public.movements add column group_id uuid;
create index movements_group_idx on public.movements (group_id) where group_id is not null;

-- Internal FIFO take. NOT callable by clients: it performs no role checks of its own.
create function public.take_fifo(
  p_company uuid, p_warehouse uuid, p_product uuid, p_qty numeric, p_batch uuid,
  p_kind public.movement_kind, p_price numeric, p_markdown boolean, p_note text, p_request uuid, p_group uuid
) returns table (out_batch uuid, out_qty numeric)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_need numeric := p_qty;
  v_batch record;
  v_take numeric;
begin
  for v_batch in
    select b.id, b.qty - coalesce((select sum(m.qty) from public.movements m where m.batch_id = b.id and m.voided_at is null), 0) as left_qty
    from public.batches b
    where b.company_id = p_company and b.warehouse_id = p_warehouse and b.product_id = p_product
      and (p_batch is null or b.id = p_batch)
    order by b.received_on, b.created_at
    for update of b
  loop
    exit when v_need <= 0;
    continue when v_batch.left_qty <= 0;
    v_take := least(v_need, v_batch.left_qty);
    insert into public.movements (company_id, batch_id, qty, kind, price, markdown, note, request_id, group_id, created_by)
    values (p_company, v_batch.id, v_take, p_kind, p_price, coalesce(p_markdown, false), p_note, p_request, p_group, auth.uid());
    out_batch := v_batch.id;
    out_qty := v_take;
    return next;
    v_need := v_need - v_take;
  end loop;
  if v_need > 0 then
    raise exception 'not enough stock: % short', v_need using errcode = '22023';
  end if;
end
$$;

-- Validate a jsonb list of {product_id, qty, price?} lines against the company.
create function public.check_lines(p_company uuid, p_lines jsonb) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_line jsonb;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'lines must contain 1 to 50 items' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((v_line ->> 'qty')::numeric, 0) <= 0 or coalesce((v_line ->> 'price')::numeric, 0) < 0 then
      raise exception 'every line needs a positive qty and a non-negative price' using errcode = '22023';
    end if;
    if not exists (select 1 from public.products where id = (v_line ->> 'product_id')::uuid and company_id = p_company) then
      raise exception 'product not found' using errcode = 'P0002';
    end if;
  end loop;
end
$$;

-- ship_request now reuses take_fifo (same behaviour as before).
create or replace function public.ship_request(p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.requests%rowtype;
  v_line public.request_lines%rowtype;
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
    perform public.take_fifo(v_req.company_id, v_req.warehouse_id, v_line.product_id, v_line.qty, v_line.batch_id,
                             'ship', v_line.price, false, null, p_request, p_request);
  end loop;
  update public.requests set status = 'done', status_by = auth.uid(), status_at = now() where id = p_request;
  insert into public.notifications (company_id, user_id, kind, payload)
  select v_req.company_id, u, 'request_done', jsonb_build_object('request_id', v_req.id, 'number', v_req.number)
  from (select v_req.created_by as u union select m.user_id from public.members m where m.company_id = v_req.company_id and m.role = 'owner') r
  where u <> auth.uid();
end
$$;

create function public.start_request(p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.requests%rowtype;
begin
  select * into v_req from public.requests where id = p_request for update;
  perform public.require_role(v_req.company_id, array['owner', 'staff']::public.member_role[]);
  if not public.can_use_warehouse(v_req.company_id, v_req.warehouse_id) then
    raise exception 'not allowed for this warehouse' using errcode = '42501';
  end if;
  if v_req.status <> 'new' then
    raise exception 'only new requests can be started' using errcode = '55000';
  end if;
  update public.requests set status = 'in_progress', status_by = auth.uid(), status_at = now() where id = p_request;
end
$$;

-- Owner and staff cancel any open request; a manager only their own.
create function public.cancel_request(p_request uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_req public.requests%rowtype;
  v_role public.member_role;
begin
  select * into v_req from public.requests where id = p_request for update;
  v_role := public.require_role(v_req.company_id, array['owner', 'staff', 'manager']::public.member_role[]);
  if v_role = 'manager' and v_req.created_by <> auth.uid() then
    raise exception 'a manager can cancel only their own requests' using errcode = '42501';
  end if;
  if v_role = 'staff' and not public.can_use_warehouse(v_req.company_id, v_req.warehouse_id) then
    raise exception 'not allowed for this warehouse' using errcode = '42501';
  end if;
  if v_req.status not in ('new', 'in_progress') then
    raise exception 'request is already closed' using errcode = '55000';
  end if;
  update public.requests set status = 'cancelled', status_by = auth.uid(), status_at = now() where id = p_request;
  insert into public.notifications (company_id, user_id, kind, payload)
  select v_req.company_id, u, 'request_cancelled', jsonb_build_object('request_id', v_req.id, 'number', v_req.number)
  from (select v_req.created_by as u union select m.user_id from public.members m where m.company_id = v_req.company_id and m.role = 'owner') r
  where u <> auth.uid();
end
$$;

-- Sale without a request (market point). Returns the sale id used to cancel it.
create function public.record_sale(p_warehouse uuid, p_lines jsonb, p_markdown boolean default false, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_group uuid := gen_random_uuid();
  v_line jsonb;
begin
  select company_id into v_company from public.warehouses where id = p_warehouse and not archived;
  perform public.require_role(v_company, array['owner', 'staff']::public.member_role[]);
  if not public.can_use_warehouse(v_company, p_warehouse) then
    raise exception 'not allowed for this warehouse' using errcode = '42501';
  end if;
  perform public.check_lines(v_company, p_lines);
  for v_line in select * from jsonb_array_elements(p_lines) loop
    perform public.take_fifo(v_company, p_warehouse, (v_line ->> 'product_id')::uuid, (v_line ->> 'qty')::numeric, null,
                             'sale', (v_line ->> 'price')::numeric, p_markdown, nullif(btrim(p_note), ''), null, v_group);
  end loop;
  return v_group;
end
$$;

-- Cancel a sale or write-off (all its rows): the author on the same day, or the owner at any time.
create or replace function public.void_movement(p_movement uuid) returns void
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
  update public.movements set voided_at = now(), voided_by = auth.uid()
  where voided_at is null and (id = p_movement or (v_mov.group_id is not null and group_id = v_mov.group_id));
end
$$;

-- Move between warehouses; the receiving batch keeps the original receipt date (batch age).
create function public.move_stock(p_from uuid, p_to uuid, p_product uuid, p_qty numeric, p_batch uuid default null)
returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_to_company uuid;
  v_group uuid := gen_random_uuid();
  v_take record;
begin
  select company_id into v_company from public.warehouses where id = p_from;
  select company_id into v_to_company from public.warehouses where id = p_to and not archived;
  perform public.require_role(v_company, array['owner', 'staff']::public.member_role[]);
  if v_to_company is distinct from v_company then
    raise exception 'destination warehouse not found' using errcode = 'P0002';
  end if;
  if p_from = p_to or p_qty is null or p_qty <= 0 then
    raise exception 'choose two different warehouses and a positive qty' using errcode = '22023';
  end if;
  if not (public.can_use_warehouse(v_company, p_from) and public.can_use_warehouse(v_company, p_to)) then
    raise exception 'not allowed for this warehouse' using errcode = '42501';
  end if;
  for v_take in select * from public.take_fifo(v_company, p_from, p_product, p_qty, p_batch, 'move_out', null, false, null, null, v_group) loop
    insert into public.batches (company_id, warehouse_id, product_id, qty, received_on, supplier, unit_cost, source_batch_id, kind, created_by)
    select v_company, p_to, b.product_id, v_take.out_qty, b.received_on, b.supplier, b.unit_cost, b.id, 'move_in', auth.uid()
    from public.batches b where b.id = v_take.out_batch;
  end loop;
  return p_qty;
end
$$;

-- Stock count: staff submits facts; differences wait for the owner's decision.
create function public.submit_stock_count(p_warehouse uuid, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_lines jsonb;
  v_id uuid;
begin
  select company_id into v_company from public.warehouses where id = p_warehouse;
  perform public.require_role(v_company, array['owner', 'staff']::public.member_role[]);
  if not public.can_use_warehouse(v_company, p_warehouse) then
    raise exception 'not allowed for this warehouse' using errcode = '42501';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 200
     or exists (select 1 from jsonb_array_elements(p_lines) l where coalesce((l ->> 'fact')::numeric, -1) < 0) then
    raise exception 'lines must contain 1 to 200 items with a fact of 0 or more' using errcode = '22023';
  end if;
  select jsonb_agg(jsonb_build_object('product_id', p.id, 'fact', (l ->> 'fact')::numeric,
           'sys', coalesce((select sum(s.left_qty) from public.stock_batches s where s.warehouse_id = p_warehouse and s.product_id = p.id), 0)))
  into v_lines
  from jsonb_array_elements(p_lines) l
  join public.products p on p.id = (l ->> 'product_id')::uuid and p.company_id = v_company;
  if v_lines is null or jsonb_array_length(v_lines) <> jsonb_array_length(p_lines) then
    raise exception 'product not found' using errcode = 'P0002';
  end if;
  insert into public.stock_counts (company_id, warehouse_id, lines, created_by)
  values (v_company, p_warehouse, v_lines, auth.uid()) returning id into v_id;
  if not exists (select 1 from jsonb_array_elements(v_lines) l where (l ->> 'fact')::numeric <> (l ->> 'sys')::numeric) then
    update public.stock_counts set status = 'applied', reason = 'no differences', status_by = auth.uid(), status_at = now() where id = v_id;
  end if;
  return v_id;
end
$$;

create function public.apply_stock_count(p_count uuid, p_approve boolean, p_reason text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count public.stock_counts%rowtype;
  v_line jsonb;
  v_diff numeric;
  v_group uuid := gen_random_uuid();
begin
  select * into v_count from public.stock_counts where id = p_count for update;
  perform public.require_role(v_count.company_id, array['owner']::public.member_role[]);
  if v_count.status <> 'pending' then
    raise exception 'stock count is already processed' using errcode = '55000';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if p_approve then
    for v_line in select * from jsonb_array_elements(v_count.lines) loop
      v_diff := (v_line ->> 'fact')::numeric - (v_line ->> 'sys')::numeric;
      if v_diff < 0 then
        perform public.take_fifo(v_count.company_id, v_count.warehouse_id, (v_line ->> 'product_id')::uuid, -v_diff, null,
                                 'shortage', null, false, btrim(p_reason), null, v_group);
      elsif v_diff > 0 then
        insert into public.batches (company_id, warehouse_id, product_id, qty, received_on, kind, created_by)
        values (v_count.company_id, v_count.warehouse_id, (v_line ->> 'product_id')::uuid, v_diff, current_date, 'surplus', auth.uid());
      end if;
    end loop;
  end if;
  update public.stock_counts
  set status = case when p_approve then 'applied'::public.count_status else 'rejected'::public.count_status end,
      reason = btrim(p_reason), status_by = auth.uid(), status_at = now()
  where id = p_count;
end
$$;

-- Daily job: notify owners and staff about batches older than p_days. At most once per batch per day.
create function public.notify_stale_batches(p_days integer default 7) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
begin
  insert into public.notifications (company_id, user_id, kind, payload)
  select s.company_id, m.user_id, 'batch_stale',
         jsonb_build_object('batch_id', s.id, 'warehouse_id', s.warehouse_id, 'product_id', s.product_id,
                            'received_on', s.received_on, 'left_qty', s.left_qty)
  from public.stock_batches s
  join public.members m on m.company_id = s.company_id
   and (m.role = 'owner' or (m.role = 'staff' and (cardinality(m.warehouse_ids) = 0 or s.warehouse_id = any (m.warehouse_ids))))
  join public.companies c on c.id = s.company_id and c.blocked_at is null
  where s.left_qty > 0 and s.received_on <= current_date - p_days
    and not exists (
      select 1 from public.notifications n
      where n.user_id = m.user_id and n.kind = 'batch_stale' and n.payload ->> 'batch_id' = s.id::text
        and n.created_at >= date_trunc('day', now())
    );
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Schedule the daily job where pg_cron is available (Supabase): 03:00 UTC = 08:00 Yekaterinburg.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('moy-sklad-stale-batches', '0 3 * * *', 'select public.notify_stale_batches()');
  end if;
end
$$;

-- ── Function privileges ────────────────────────────────────────────────────────────────
-- Internal helpers stay closed to every client role (Supabase grants new functions to them by default).
revoke execute on function public.take_fifo(uuid, uuid, uuid, numeric, uuid, public.movement_kind, numeric, boolean, text, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.check_lines(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.notify_stale_batches(integer) from public, anon, authenticated;
revoke execute on function public.require_role(uuid, public.member_role[]) from public, anon, authenticated;
revoke execute on function public.audit() from public, anon, authenticated;
revoke execute on all functions in schema public from anon;
grant execute on function
  public.start_request(uuid), public.cancel_request(uuid), public.record_sale(uuid, jsonb, boolean, text),
  public.void_movement(uuid), public.move_stock(uuid, uuid, uuid, numeric, uuid),
  public.submit_stock_count(uuid, jsonb), public.apply_stock_count(uuid, boolean, text), public.ship_request(uuid)
to authenticated;

-- «Мой склад»: write off spoilage by product, oldest batches first, in one transaction.
-- write_off() takes a single batch; the app's «Порча» screen picks a product, so it calls this one.
-- All rows share a group_id, so void_movement() on any of them cancels the whole write-off.
create function public.write_off_fifo(p_warehouse uuid, p_product uuid, p_qty numeric, p_reason public.waste_reason, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_company uuid;
  v_group uuid := gen_random_uuid();
  v_need numeric := p_qty;
  v_batch record;
  v_take numeric;
begin
  select company_id into v_company from public.warehouses where id = p_warehouse;
  perform public.require_role(v_company, array['owner', 'staff']::public.member_role[]);
  if not public.can_use_warehouse(v_company, p_warehouse) then
    raise exception 'not allowed for this warehouse' using errcode = '42501';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'qty must be greater than 0' using errcode = '22023';
  end if;
  if p_reason is null or (p_reason = 'other' and nullif(btrim(p_note), '') is null) then
    raise exception 'a reason is required; "other" also needs a note' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product and company_id = v_company) then
    raise exception 'product not found' using errcode = 'P0002';
  end if;

  for v_batch in
    select b.id, b.qty - coalesce((select sum(m.qty) from public.movements m where m.batch_id = b.id and m.voided_at is null), 0) as left_qty
    from public.batches b
    where b.company_id = v_company and b.warehouse_id = p_warehouse and b.product_id = p_product
    order by b.received_on, b.created_at
    for update of b
  loop
    exit when v_need <= 0;
    continue when v_batch.left_qty <= 0;
    v_take := least(v_need, v_batch.left_qty);
    insert into public.movements (company_id, batch_id, qty, kind, reason, note, group_id, created_by)
    values (v_company, v_batch.id, v_take, 'waste', p_reason, nullif(btrim(p_note), ''), v_group, auth.uid());
    v_need := v_need - v_take;
  end loop;
  if v_need > 0 then
    raise exception 'not enough stock: % short', v_need using errcode = '22023';
  end if;
  return v_group;
end
$$;

revoke execute on function public.write_off_fifo(uuid, uuid, numeric, public.waste_reason, text) from public, anon;
grant execute on function public.write_off_fifo(uuid, uuid, numeric, public.waste_reason, text) to authenticated;

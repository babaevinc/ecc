-- «Мой склад»: guards for the owner's catalog screen (products, warehouses) and for members.
-- RLS already limits these writes to the owner; the triggers stop changes that would corrupt the books:
--   * a product's unit cannot change once it has batches (10 «коробок» must not become 10 «кг»);
--   * a product or warehouse with stock left cannot be archived (the stock would vanish from the screens);
--   * a company always keeps at least one owner.
-- Deleting a product or warehouse that has history is already refused by the foreign keys (23503).

create function public.guard_product_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.unit is distinct from old.unit and exists (select 1 from public.batches b where b.product_id = old.id) then
    raise exception 'the unit cannot change once the product has batches' using errcode = '55000';
  end if;
  if new.archived and not old.archived
     and exists (select 1 from public.stock_batches s where s.product_id = old.id and s.left_qty > 0) then
    raise exception 'sell or write off the remaining stock before archiving' using errcode = '55000';
  end if;
  return new;
end
$$;
create trigger products_guard before update on public.products for each row execute function public.guard_product_change();

create function public.guard_warehouse_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.archived and not old.archived
     and exists (select 1 from public.stock_batches s where s.warehouse_id = old.id and s.left_qty > 0) then
    raise exception 'sell, move or write off the remaining stock before archiving' using errcode = '55000';
  end if;
  return new;
end
$$;
create trigger warehouses_guard before update on public.warehouses for each row execute function public.guard_warehouse_change();

create function public.guard_last_owner() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.role = 'owner' and (tg_op = 'DELETE' or new.role <> 'owner' or new.company_id <> old.company_id)
     -- when the whole company is being deleted its members go with it
     and exists (select 1 from public.companies c where c.id = old.company_id)
     and not exists (select 1 from public.members m where m.company_id = old.company_id and m.role = 'owner' and m.user_id <> old.user_id) then
    raise exception 'a company must keep at least one owner' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;
create trigger members_last_owner before update or delete on public.members for each row execute function public.guard_last_owner();

revoke execute on function public.guard_product_change() from public, anon, authenticated;
revoke execute on function public.guard_warehouse_change() from public, anon, authenticated;
revoke execute on function public.guard_last_owner() from public, anon, authenticated;

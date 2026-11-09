-- «Мой склад» — push delivery: the notify Edge Function claims unsent notifications and sends them
-- through Expo Push. The in-app feed (notifications table) works with or without push.

alter table public.notifications add column pushed_at timestamptz;
create index notifications_unsent_idx on public.notifications (created_at) where pushed_at is null;

-- Server only. Claims up to p_limit unsent notifications (marks them as pushed, skipping rows another
-- worker holds) and returns one row per device token with the names needed for the message text.
create function public.claim_push_batch(p_limit integer default 500)
returns table (notification_id uuid, token text, kind text, payload jsonb, details jsonb)
language plpgsql security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
begin
  return query
  with claimed as (
    update public.notifications n set pushed_at = now()
    where n.id in (
      select x.id from public.notifications x where x.pushed_at is null
      order by x.created_at limit greatest(1, least(p_limit, 1000))
      for update skip locked
    )
    returning n.id, n.user_id, n.kind, n.payload
  )
  select c.id, t.token, c.kind, c.payload,
         jsonb_strip_nulls(jsonb_build_object(
           'number', c.payload -> 'number',
           'warehouse', (select w.name from public.warehouses w
                         where w.id = coalesce((c.payload ->> 'warehouse_id')::uuid,
                                               (select r.warehouse_id from public.requests r where r.id = (c.payload ->> 'request_id')::uuid))),
           'client', (select r.client from public.requests r where r.id = (c.payload ->> 'request_id')::uuid),
           'product', (select p.name from public.products p where p.id = (c.payload ->> 'product_id')::uuid),
           'unit', (select p.unit from public.products p where p.id = (c.payload ->> 'product_id')::uuid),
           'received_on', c.payload -> 'received_on',
           'left_qty', c.payload -> 'left_qty'))
  from claimed c
  join public.push_tokens t on t.user_id = c.user_id;
end
$$;

-- Server only. Removes a token Expo reported as DeviceNotRegistered.
create function public.forget_push_token(p_token text) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_count integer;
begin
  delete from public.push_tokens where token = p_token;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

revoke execute on function public.claim_push_batch(integer) from public, anon, authenticated;
revoke execute on function public.forget_push_token(text) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.claim_push_batch(integer), public.forget_push_token(text) to service_role;
  end if;
end
$$;

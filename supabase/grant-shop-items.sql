-- Manually grant shop items or credits to a Vaulted account.
-- Run this in the Supabase SQL Editor as the project owner. It uses database
-- privileges and is intentionally not exposed through the public app/API.
-- Edit target_username, item_ids, and (optionally) credit_amount below.
begin;

do $$
declare
  target_username text := 'Xander';
  item_ids text[] := array[
    'profile_effect-alwayswatching',
    'profile_effect-bonsaieternity',
    'profile_effect-pinkflowers',
    'avatar_decoration-sweatdrops',
    'avatar_decoration-fallfoliage'
  ];
  credit_amount bigint := 0;
  target_id uuid;
  valid_items integer;
begin
  select id into target_id
  from public.profiles
  where lower(username) = lower(trim(target_username));

  if target_id is null then
    raise exception 'No Vaulted profile found for username "%".', target_username;
  end if;

  select count(*) into valid_items
  from public.shop_catalog
  where id = any(item_ids);
  if valid_items <> cardinality(item_ids) then
    raise exception 'One or more item IDs are missing from shop_catalog.';
  end if;

  insert into public.shop_wallets(user_id)
  values (target_id)
  on conflict (user_id) do nothing;

  insert into public.shop_inventory(user_id, item_id)
  select target_id, unnest(item_ids)
  on conflict (user_id, item_id) do nothing;

  if credit_amount < 0 then
    raise exception 'credit_amount must be zero or greater.';
  elsif credit_amount > 0 then
    update public.shop_wallets
    set balance = balance + credit_amount, updated_at = now()
    where user_id = target_id;

    insert into public.shop_ledger(user_id, amount, reason)
    values (target_id, credit_amount, 'manual_admin_grant');
  end if;
end $$;

commit;

-- The granted items will appear in the account's Shop > Owned collection.
-- To equip one, use the normal Equip button there. This avoids overwriting an
-- existing equipped cosmetic when granting items.

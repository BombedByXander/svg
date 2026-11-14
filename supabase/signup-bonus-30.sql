-- Apply once in the Vaulted Supabase SQL Editor after the shop schema exists.
-- Give each newly-created Auth user 30 credits exactly once.
create or replace function public.vaulted_grant_signup_bonus()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.shop_wallets (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  insert into public.shop_ledger (user_id, amount, reason, event_key)
  values (new.id, 30, 'signup_bonus', 'signup:' || new.id::text)
  on conflict (user_id, event_key) do nothing;

  if found then
    update public.shop_wallets
    set balance = balance + 30, updated_at = now()
    where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.vaulted_grant_signup_bonus() from public, anon, authenticated;
drop trigger if exists vaulted_signup_bonus on auth.users;
create trigger vaulted_signup_bonus
after insert on auth.users
for each row execute function public.vaulted_grant_signup_bonus();
notify pgrst, 'reload schema';


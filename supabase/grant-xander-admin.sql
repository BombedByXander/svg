-- Run once in the Berri Supabase project's SQL Editor as the project owner.
-- This grants the Berri Admin tier to the existing username "xander".
-- It does not grant access to anyone based on profile badges.

begin;

create table if not exists public.site_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users (id) on delete set null
);

alter table public.site_admins enable row level security;
revoke all on public.site_admins from public, anon, authenticated;
grant all on public.site_admins to service_role;

create or replace function public.berri_my_admin_tier()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from public.site_admins where user_id = (select auth.uid())
  ) then 'admin' else 'none' end;
$$;

revoke all on function public.berri_my_admin_tier() from public, anon;
grant execute on function public.berri_my_admin_tier() to authenticated;

do $$
declare
  xander_id uuid;
begin
  select id into xander_id
  from public.profiles
  where lower(username) = 'xander'
  limit 1;

  if xander_id is null then
    raise exception 'No Berri profile named xander exists yet. Create/sign in to xander first, then run this SQL again.';
  end if;

  insert into public.site_admins (user_id)
  values (xander_id)
  on conflict (user_id) do nothing;
end;
$$;

notify pgrst, 'reload schema';
commit;

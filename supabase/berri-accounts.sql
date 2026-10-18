-- Berri account/profile foundation for a fresh Supabase project.
-- Run in Supabase SQL Editor. This creates app data tables linked to Supabase Auth.
-- It does not create Auth users or implement username-based login by itself.

begin;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique
    check (username = lower(username) and username ~ '^[a-z0-9_.-]{3,24}$'),
  display_name text not null default '' check (char_length(display_name) <= 40),
  bio text not null default '' check (char_length(bio) <= 450),
  pronouns text not null default '' check (char_length(pronouns) <= 32),
  avatar_url text,
  banner_url text,
  primary_color text not null default '#ec4899'
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  secondary_color text not null default '#7c3aed'
    check (secondary_color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep recovery addresses private; never expose them on public profiles.
create table if not exists public.private_account_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  recovery_email text,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.favorite_games (
  user_id uuid not null references auth.users (id) on delete cascade,
  game_url text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, game_url)
);

-- Readable for public profile stats. Writes should come from a trusted server function,
-- not directly from a browser, so clients cannot award themselves playtime.
create table if not exists public.game_stats (
  user_id uuid not null references auth.users (id) on delete cascade,
  game_url text not null,
  play_seconds bigint not null default 0 check (play_seconds >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, game_url)
);

-- Tags are public, but only trusted administrative code should assign or remove them.
create table if not exists public.profile_tags (
  user_id uuid not null references auth.users (id) on delete cascade,
  tag text not null check (char_length(tag) between 1 and 32),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references auth.users (id) on delete set null,
  primary key (user_id, tag)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists private_account_data_set_updated_at on public.private_account_data;
create trigger private_account_data_set_updated_at
before update on public.private_account_data
for each row execute function public.set_updated_at();

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at
before update on public.user_settings
for each row execute function public.set_updated_at();

drop trigger if exists game_stats_set_updated_at on public.game_stats;
create trigger game_stats_set_updated_at
before update on public.game_stats
for each row execute function public.set_updated_at();

-- Create a public profile automatically for each new Supabase Auth user.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_recovery_email text;
begin
  v_username := lower(regexp_replace(
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
      split_part(coalesce(new.email, ''), '@', 1),
      'user_' || left(replace(new.id::text, '-', ''), 12)
    ),
    '[^a-z0-9_.-]+', '_', 'g'
  ));
  v_username := left(v_username, 24);
  if char_length(v_username) < 3 then
    v_username := 'user_' || left(replace(new.id::text, '-', ''), 12);
  end if;

  insert into public.profiles (id, username, display_name, bio, pronouns)
  values (
    new.id,
    v_username,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 40),
    left(coalesce(new.raw_user_meta_data ->> 'bio', ''), 450),
    left(coalesce(new.raw_user_meta_data ->> 'pronouns', ''), 32)
  );

  v_recovery_email := nullif(btrim(new.raw_user_meta_data ->> 'recovery_email'), '');
  if v_recovery_email is not null then
    insert into public.private_account_data (user_id, recovery_email)
    values (new.id, v_recovery_email)
    on conflict (user_id) do update set recovery_email = excluded.recovery_email;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_berri on auth.users;
create trigger on_auth_user_created_berri
after insert on auth.users
for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.private_account_data enable row level security;
alter table public.user_settings enable row level security;
alter table public.favorite_games enable row level security;
alter table public.game_stats enable row level security;
alter table public.profile_tags enable row level security;

revoke all on public.profiles, public.private_account_data, public.user_settings,
  public.favorite_games, public.game_stats, public.profile_tags from anon, authenticated;

grant select on public.profiles, public.favorite_games, public.game_stats, public.profile_tags
  to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.private_account_data, public.user_settings
  to authenticated;
grant insert, update, delete on public.favorite_games to authenticated;
grant all on public.profiles, public.private_account_data, public.user_settings,
  public.favorite_games, public.game_stats, public.profile_tags to service_role;

drop policy if exists "Public profiles are readable" on public.profiles;
create policy "Public profiles are readable" on public.profiles
  for select to anon, authenticated using (true);
drop policy if exists "Users create their own profile" on public.profiles;
create policy "Users create their own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
drop policy if exists "Users update their own profile" on public.profiles;
create policy "Users update their own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users read their private account data" on public.private_account_data;
create policy "Users read their private account data" on public.private_account_data
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Users insert their private account data" on public.private_account_data;
create policy "Users insert their private account data" on public.private_account_data
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users update their private account data" on public.private_account_data;
create policy "Users update their private account data" on public.private_account_data
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users delete their private account data" on public.private_account_data;
create policy "Users delete their private account data" on public.private_account_data
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Users manage their settings" on public.user_settings;
create policy "Users manage their settings" on public.user_settings
  for all to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Public favorites are readable" on public.favorite_games;
create policy "Public favorites are readable" on public.favorite_games
  for select to anon, authenticated using (true);
drop policy if exists "Users add their own favorites" on public.favorite_games;
create policy "Users add their own favorites" on public.favorite_games
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Users update their own favorites" on public.favorite_games;
create policy "Users update their own favorites" on public.favorite_games
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
drop policy if exists "Users remove their own favorites" on public.favorite_games;
create policy "Users remove their own favorites" on public.favorite_games
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "Public playtime stats are readable" on public.game_stats;
create policy "Public playtime stats are readable" on public.game_stats
  for select to anon, authenticated using (true);

drop policy if exists "Public profile tags are readable" on public.profile_tags;
create policy "Public profile tags are readable" on public.profile_tags
  for select to anon, authenticated using (true);

commit;

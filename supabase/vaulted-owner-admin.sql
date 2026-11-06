-- Vaulted owner tools. Run AFTER berri-accounts.sql, grant-xander-admin.sql,
-- and vaulted-shop.sql in the Vaulted Supabase SQL Editor.
-- Only the account whose public username is exactly `xander` and whose ID is
-- present in site_admins can call the privileged functions below.

begin;

create table if not exists public.site_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid references auth.users(id) on delete set null
);
alter table public.site_admins enable row level security;
revoke all on public.site_admins from public, anon, authenticated;
grant all on public.site_admins to service_role;

do $$
declare owner_id uuid;
begin
  select id into owner_id from public.profiles where lower(username)='xander' limit 1;
  if owner_id is null then
    raise exception 'Create/sign in to the xander account, then run this SQL again.';
  end if;
  insert into public.site_admins(user_id) values(owner_id) on conflict(user_id) do nothing;
end $$;

-- Arbitrary-size whole-number balances and ledger entries, within PostgreSQL
-- numeric's supported precision. The panel accepts up to 1,000 digits per edit.
alter table public.shop_wallets alter column balance type numeric using balance::numeric;
alter table public.shop_ledger alter column amount type numeric using amount::numeric;
alter table public.shop_ledger add column if not exists created_by uuid references auth.users(id) on delete set null;

create table if not exists public.site_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check(char_length(title) between 1 and 100),
  message text not null check(char_length(message) between 1 and 2000),
  kind text not null default 'info' check(kind in ('info','success','warning','critical')),
  published boolean not null default true,
  dismissible boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists site_announcements_active_idx on public.site_announcements(published,starts_at,ends_at);
alter table public.site_announcements enable row level security;
revoke all on public.site_announcements from public,anon,authenticated;
grant select on public.site_announcements to service_role;

create or replace function public.vaulted_admin_is_owner()
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.profiles p
    join public.site_admins a on a.user_id=p.id
    where p.id=(select auth.uid()) and lower(p.username)='xander'
  );
$$;
revoke all on function public.vaulted_admin_is_owner() from public,anon;
grant execute on function public.vaulted_admin_is_owner() to authenticated;

create or replace function public.vaulted_admin_access()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.vaulted_admin_is_owner() then return jsonb_build_object('owner',false); end if;
  return jsonb_build_object('owner',true,'username','xander');
end;
$$;

create or replace function public.vaulted_admin_overview()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare users_count bigint; wallets_count bigint; cosmetics_count bigint; total_credits text; active_announcements bigint;
begin
  if not public.vaulted_admin_is_owner() then raise exception 'Owner access required.'; end if;
  select count(*) into users_count from public.profiles;
  select count(*),coalesce(sum(balance),0)::text into wallets_count,total_credits from public.shop_wallets;
  select count(*) into cosmetics_count from public.shop_inventory;
  select count(*) into active_announcements from public.site_announcements
    where published and starts_at<=now() and (ends_at is null or ends_at>now());
  return jsonb_build_object('users',users_count,'wallets',wallets_count,'cosmeticsOwned',cosmetics_count,
    'creditsExact',total_credits,'activeAnnouncements',active_announcements);
end;
$$;

create or replace function public.vaulted_admin_search_users(p_query text default '')
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare result jsonb;
begin
  if not public.vaulted_admin_is_owner() then raise exception 'Owner access required.'; end if;
  select coalesce(jsonb_agg(to_jsonb(matched) order by matched.username),'[]'::jsonb) into result
  from (
    select p.id,p.username,p.display_name,p.created_at,
      coalesce(w.balance,0)::text as credits,
      (select count(*) from public.shop_inventory i where i.user_id=p.id) as cosmetics_owned
    from public.profiles p
    left join public.shop_wallets w on w.user_id=p.id
    where nullif(btrim(p_query),'') is null
      or p.username ilike '%'||left(btrim(p_query),80)||'%'
      or p.display_name ilike '%'||left(btrim(p_query),80)||'%'
    order by p.username limit 50
  ) matched;
  return result;
end;
$$;

create or replace function public.vaulted_admin_adjust_credits(p_username text,p_amount text,p_note text default '')
returns jsonb language plpgsql security definer set search_path=''
as $$
declare owner_id uuid:=auth.uid(); target_id uuid; target_name text; amount numeric; new_balance numeric;
begin
  if not public.vaulted_admin_is_owner() then raise exception 'Owner access required.'; end if;
  if p_amount is null or p_amount !~ '^-?[0-9]{1,1000}$' then raise exception 'Enter a whole-number adjustment with at most 1,000 digits.'; end if;
  amount:=p_amount::numeric;
  if amount=0 then raise exception 'Adjustment cannot be zero.'; end if;
  select id,username into target_id,target_name from public.profiles where lower(username)=lower(btrim(p_username));
  if target_id is null then raise exception 'No user found with that username.'; end if;
  insert into public.shop_wallets(user_id) values(target_id) on conflict(user_id) do nothing;
  select balance into new_balance from public.shop_wallets where user_id=target_id for update;
  new_balance:=new_balance+amount;
  if new_balance<0 then raise exception 'This adjustment would make the balance negative.'; end if;
  update public.shop_wallets set balance=new_balance,updated_at=now() where user_id=target_id;
  insert into public.shop_ledger(user_id,amount,reason,event_key,created_by)
    values(target_id,amount,case when amount>0 then 'admin_grant' else 'admin_remove' end||case when nullif(btrim(p_note),'') is null then '' else ':'||left(btrim(p_note),200) end,null,owner_id);
  return jsonb_build_object('ok',true,'username',target_name,'applied',amount::text,'credits',new_balance::text);
end;
$$;

create or replace function public.vaulted_admin_list_announcements()
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare result jsonb;
begin
  if not public.vaulted_admin_is_owner() then raise exception 'Owner access required.'; end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) into result
  from (select id,title,message,kind,published,dismissible,starts_at,ends_at,created_at
        from public.site_announcements order by created_at desc limit 50) a;
  return result;
end;
$$;

create or replace function public.vaulted_admin_activity(p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
declare result jsonb;
begin
  if not public.vaulted_admin_is_owner() then raise exception 'Owner access required.'; end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc),'[]'::jsonb) into result
  from (
    select p.username,l.amount::text as amount,l.reason,l.created_at
    from public.shop_ledger l join public.profiles p on p.id=l.user_id
    where l.reason like 'admin_grant%' or l.reason like 'admin_remove%'
    order by l.created_at desc limit least(greatest(coalesce(p_limit,50),1),100)
  ) a;
  return result;
end;
$$;

create or replace function public.vaulted_admin_create_announcement(
  p_title text,p_message text,p_kind text default 'info',p_dismissible boolean default true,p_ends_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare result public.site_announcements;
begin
  if not public.vaulted_admin_is_owner() then raise exception 'Owner access required.'; end if;
  if char_length(btrim(coalesce(p_title,''))) not between 1 and 100 then raise exception 'Title must be 1–100 characters.'; end if;
  if char_length(btrim(coalesce(p_message,''))) not between 1 and 2000 then raise exception 'Message must be 1–2,000 characters.'; end if;
  if p_kind not in ('info','success','warning','critical') then raise exception 'Choose a valid announcement style.'; end if;
  insert into public.site_announcements(title,message,kind,published,dismissible,ends_at,created_by)
    values(btrim(p_title),btrim(p_message),p_kind,true,coalesce(p_dismissible,true),p_ends_at,auth.uid()) returning * into result;
  return jsonb_build_object('ok',true,'id',result.id);
end;
$$;

create or replace function public.vaulted_admin_remove_announcement(p_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
begin
  if not public.vaulted_admin_is_owner() then raise exception 'Owner access required.'; end if;
  update public.site_announcements set published=false where id=p_id;
  if not found then raise exception 'Announcement not found.'; end if;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.vaulted_active_announcements()
returns jsonb language sql stable security definer set search_path=''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'title',a.title,'message',a.message,'kind',a.kind,
    'dismissible',a.dismissible,'created_at',a.created_at) order by a.created_at desc),'[]'::jsonb)
  from public.site_announcements a where a.published and a.starts_at<=now() and (a.ends_at is null or a.ends_at>now());
$$;

revoke all on function public.vaulted_admin_access(),public.vaulted_admin_overview(),public.vaulted_admin_search_users(text),
  public.vaulted_admin_adjust_credits(text,text,text),public.vaulted_admin_list_announcements(),public.vaulted_admin_activity(integer),
  public.vaulted_admin_create_announcement(text,text,text,boolean,timestamptz),public.vaulted_admin_remove_announcement(uuid),
  public.vaulted_active_announcements() from public,anon,authenticated;
grant execute on function public.vaulted_admin_access(),public.vaulted_admin_overview(),public.vaulted_admin_search_users(text),
  public.vaulted_admin_adjust_credits(text,text,text),public.vaulted_admin_list_announcements(),public.vaulted_admin_activity(integer),
  public.vaulted_admin_create_announcement(text,text,text,boolean,timestamptz) to authenticated;
grant execute on function public.vaulted_admin_remove_announcement(uuid) to authenticated;
grant execute on function public.vaulted_active_announcements() to anon,authenticated;

-- Keep the public leaderboard query working when an owner grants a balance
-- larger than bigint can hold. Its credits column is numeric to match wallets.
drop function if exists public.vaulted_leaderboard(integer,integer);
create function public.vaulted_leaderboard(p_limit integer default 51, p_offset integer default 0)
returns table (user_id uuid, username text, display_name text, avatar_url text, credits numeric, games_played bigint, play_seconds bigint)
language sql stable security definer set search_path = pg_catalog, public
as $function$
  select p.id,p.username,p.display_name,p.avatar_url,
    coalesce(w.balance,0)::numeric,
    coalesce(stats.games_played,0)::bigint,
    coalesce(stats.play_seconds,0)::bigint
  from public.profiles p
  left join public.shop_wallets w on w.user_id=p.id
  left join (
    select gs.user_id,count(*) filter(where gs.play_seconds>0)::bigint as games_played,
      sum(gs.play_seconds)::bigint as play_seconds
    from public.game_stats gs group by gs.user_id
  ) stats on stats.user_id=p.id
  order by coalesce(w.balance,0) desc,coalesce(stats.games_played,0) desc,
    coalesce(stats.play_seconds,0) desc,p.username asc
  limit greatest(1,least(coalesce(p_limit,51),51)) offset greatest(coalesce(p_offset,0),0);
$function$;
revoke all on function public.vaulted_leaderboard(integer,integer) from public,anon,authenticated;
grant execute on function public.vaulted_leaderboard(integer,integer) to anon,authenticated;
notify pgrst,'reload schema';
commit;

-- Run after berri-accounts.sql and vaulted-shop.sql. Safe to rerun.
-- Public, read-only leaderboard data for Vaulted.
-- Run after berri-accounts.sql and vaulted-shop.sql in Supabase SQL Editor.
create or replace function public.vaulted_leaderboard(p_limit integer default 51, p_offset integer default 0)
returns table (user_id uuid, username text, display_name text, avatar_url text, credits bigint, games_played bigint, play_seconds bigint)
language sql stable security definer set search_path = pg_catalog, public
as $function$
  select p.id, p.username, p.display_name, p.avatar_url,
    coalesce(w.balance, 0)::bigint,
    coalesce(stats.games_played, 0)::bigint,
    coalesce(stats.play_seconds, 0)::bigint
  from public.profiles p
  left join public.shop_wallets w on w.user_id = p.id
  left join (
    select gs.user_id,
      count(*) filter (where gs.play_seconds > 0)::bigint as games_played,
      sum(gs.play_seconds)::bigint as play_seconds
    from public.game_stats gs group by gs.user_id
  ) stats on stats.user_id = p.id
  order by coalesce(w.balance, 0) desc, coalesce(stats.games_played, 0) desc,
    coalesce(stats.play_seconds, 0) desc, p.username asc
  limit greatest(1, least(coalesce(p_limit, 51), 51)) offset greatest(coalesce(p_offset, 0), 0);
$function$;
revoke all on function public.vaulted_leaderboard(integer, integer) from public, anon, authenticated;
grant execute on function public.vaulted_leaderboard(integer, integer) to anon, authenticated;

-- Rolling 24-hour peak of active users reported by the public Realtime presence client.
-- Run this once in the Supabase SQL Editor.
create table if not exists public.vaulted_presence_peak_samples (
  bucket_start timestamptz primary key,
  active_count integer not null check (active_count >= 0 and active_count <= 50000)
);

alter table public.vaulted_presence_peak_samples enable row level security;
revoke all on table public.vaulted_presence_peak_samples from anon, authenticated, public;

create or replace function public.record_vaulted_presence_peak(p_active_count integer)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_bucket timestamptz := date_trunc('minute', statement_timestamp());
  v_peak integer;
begin
  if p_active_count is null or p_active_count < 0 or p_active_count > 50000 then
    raise exception 'active count out of range';
  end if;

  insert into public.vaulted_presence_peak_samples (bucket_start, active_count)
  values (v_bucket, p_active_count)
  on conflict (bucket_start) do update
    set active_count = greatest(public.vaulted_presence_peak_samples.active_count, excluded.active_count);

  delete from public.vaulted_presence_peak_samples
  where bucket_start < v_now - interval '25 hours';

  select coalesce(max(active_count), p_active_count) into v_peak
  from public.vaulted_presence_peak_samples
  where bucket_start >= v_now - interval '24 hours';

  return v_peak;
end;
$$;

revoke all on function public.record_vaulted_presence_peak(integer) from public;
grant execute on function public.record_vaulted_presence_peak(integer) to anon, authenticated;

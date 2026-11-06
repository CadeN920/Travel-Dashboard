-- Encryption update for an existing Wanderlog project. Run once in Supabase:
-- SQL Editor -> New query -> paste -> Run. Safe to run more than once.
--
-- Lets the app store the trip end-to-end encrypted. The trip itself goes in
-- trips.data as a sealed box the database can't read; the family link gets
-- its own sealed snapshot in trips.share_data, whose key exists only in the
-- link itself (after the '#'), never in the database.

alter table public.trips add column if not exists share_data jsonb;
grant insert (share_data), update (share_data) on public.trips to authenticated;

-- Family link: the sealed snapshot when the trip is encrypted; otherwise the
-- readable trip minus booking codes, links and notes, to-dos, profile and
-- wishlist (filtered here so those never leave the database).
create or replace function public.get_shared_trip(token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when share_data is not null then share_data
    when data ? 'enc' then null
    else (data - 'todos' - 'todoState' - 'profile' - 'wishlist')
      || jsonb_build_object('bookings', coalesce((
           select jsonb_agg(b - 'confirmation' - 'link' - 'notes')
           from jsonb_array_elements(coalesce(data -> 'bookings', '[]'::jsonb)) as b
         ), '[]'::jsonb))
  end
  from trips
  where token is not null and share_token = token;
$$;

-- A new link or turning the link off also drops the old snapshot.
create or replace function public.new_share_link(trip uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  t text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  update trips set share_token = t, share_data = null where id = trip and owner_id = auth.uid();
  if not found then raise exception 'Only the trip owner can share it'; end if;
  return t;
end $$;

create or replace function public.stop_share_link(trip uuid) returns void
language sql security definer set search_path = public as $$
  update trips set share_token = null, share_data = null where id = trip and owner_id = auth.uid();
$$;

-- Lets the app check this update has been applied.
create or replace function public.wanderlog_schema_version() returns int
language sql immutable as $$ select 2 $$;

revoke execute on function public.new_share_link(uuid), public.stop_share_link(uuid) from public, anon;
grant execute on function public.new_share_link(uuid), public.stop_share_link(uuid) to authenticated;
grant execute on function public.get_shared_trip(text), public.wanderlog_schema_version() to anon, authenticated;

-- Budget update for an existing Wanderlog project. Run once in Supabase:
-- SQL Editor -> New query -> paste -> Run. Safe to run more than once.
-- Needs encryption-update.sql to have been run first (it adds share_data).
--
-- Keeps the budget (spending log) and the Asia leg planner draft off the
-- family link when the trip isn't encrypted. (An encrypted trip's family
-- link already leaves them out.)

create or replace function public.get_shared_trip(token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when share_data is not null then share_data
    when data ? 'enc' then null
    else (data - 'todos' - 'todoState' - 'profile' - 'wishlist' - 'money' - 'asiaPlan')
      || jsonb_build_object('bookings', coalesce((
           select jsonb_agg(b - 'confirmation' - 'link' - 'notes')
           from jsonb_array_elements(coalesce(data -> 'bookings', '[]'::jsonb)) as b
         ), '[]'::jsonb))
  end
  from trips
  where token is not null and share_token = token;
$$;

create or replace function public.wanderlog_schema_version() returns int
language sql immutable as $$ select 3 $$;

grant execute on function public.get_shared_trip(text), public.wanderlog_schema_version() to anon, authenticated;

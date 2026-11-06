-- Privacy update for an existing Wanderlog project. Run once in Supabase:
-- SQL Editor -> New query -> paste -> Run. Safe to run more than once.

-- Family link: the database itself removes what family doesn't need, so
-- these fields never leave Supabase:
--   * from every booking: confirmation number, booking link, booking notes
--     (a confirmation code plus your last name can be enough to change or
--     cancel a flight)
--   * to-dos, your travel profile and your wishlist
create or replace function public.get_shared_trip(token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select (data - 'todos' - 'todoState' - 'profile' - 'wishlist')
    || jsonb_build_object('bookings', coalesce((
         select jsonb_agg(b - 'confirmation' - 'link' - 'notes')
         from jsonb_array_elements(coalesce(data -> 'bookings', '[]'::jsonb)) as b
       ), '[]'::jsonb))
  from trips
  where token is not null and share_token = token;
$$;

-- The policy helpers are only for signed-in people.
revoke execute on function public.owns_trip(uuid), public.is_trip_editor(uuid) from public, anon;
grant execute on function public.owns_trip(uuid), public.is_trip_editor(uuid) to authenticated;

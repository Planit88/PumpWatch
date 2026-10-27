-- PumpWatch database. Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It creates two tables, a view of the newest price per station and fuel, and rules that let
-- the public read prices and add new reports, but never edit or delete anything.

-- Every price someone posts. Nothing is overwritten, so you keep a full history.
create table if not exists public.reports (
  id          bigint generated always as identity primary key,
  station_id  text        not null check (station_id ~ '^([nwr][0-9]{1,15}|c-[0-9a-f-]{36})$'),
  fuel        text        not null check (fuel in ('petrol','petrol_plus','diesel','diesel_plus')),
  price       numeric(5,1) not null check (price between 80 and 350),   -- cent per litre
  source      text        not null check (source in ('driver','owner')),
  created_at  timestamptz not null default now()
);
create index if not exists reports_station_fuel_time on public.reports (station_id, fuel, created_at desc);
create index if not exists reports_time on public.reports (created_at desc);

-- Stations people add because they're missing from OpenStreetMap.
create table if not exists public.custom_stations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  town        text not null check (char_length(town) between 2 and 60),
  lat         double precision not null check (lat between 51.3 and 55.5),
  lng         double precision not null check (lng between -10.8 and -5.9),
  created_at  timestamptz not null default now()
);

-- The newest price for each station and fuel. The app reads this on start-up.
create or replace view public.latest_prices with (security_invoker = on) as
  select distinct on (station_id, fuel) station_id, fuel, price, source, created_at
  from public.reports
  order by station_id, fuel, created_at desc;

-- Access rules: anyone can read and add; nobody can change or delete through the app.
alter table public.reports enable row level security;
alter table public.custom_stations enable row level security;

drop policy if exists "Anyone can read prices" on public.reports;
create policy "Anyone can read prices" on public.reports for select to anon, authenticated using (true);
drop policy if exists "Anyone can post a price" on public.reports;
create policy "Anyone can post a price" on public.reports for insert to anon, authenticated with check (true);

drop policy if exists "Anyone can read added stations" on public.custom_stations;
create policy "Anyone can read added stations" on public.custom_stations for select to anon, authenticated using (true);
drop policy if exists "Anyone can add a station" on public.custom_stations;
create policy "Anyone can add a station" on public.custom_stations for insert to anon, authenticated with check (true);

grant select, insert on public.reports, public.custom_stations to anon, authenticated;
grant select on public.latest_prices to anon, authenticated;

-- Live updates: new prices appear on everyone's map without refreshing.
do $$ begin
  alter publication supabase_realtime add table public.reports;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.custom_stations;
exception when duplicate_object then null; end $$;

-- =========================================================
-- BRK Studio Plattform – Supabase-Schema (vorbereitet, inaktiv)
-- Einspielen: Supabase Dashboard -> SQL Editor -> ausführen.
-- Danach in assets/js/app/config.js url + anonKey eintragen und adapter: 'supabase'.
-- Passwörter verwaltet Supabase Auth (bcrypt). Rechte über Row Level Security.
-- Zeiten: date + Minuten ab Mitternacht (Ortszeit Köln), wie in der App.
-- =========================================================

create extension if not exists btree_gist;

-- ---------- Profile (1:1 zu auth.users) ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer','admin','staff')),
  name text not null,
  email text not null,
  phone text,
  created_at timestamptz not null default now()
);

-- Profil automatisch bei Registrierung anlegen (Rolle immer customer; Admin nur per SQL)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, phone)
  values (new.id, coalesce(new.raw_user_meta_data->>'name',''), new.email, new.raw_user_meta_data->>'phone');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ---------- Stammdaten ----------
create table public.settings (id int primary key default 1 check (id = 1), data jsonb not null);
insert into public.settings (data) values ('{
  "hours": {"0": null, "1": [720,1140], "2": [720,1080], "3": [720,1080], "4": [720,1140], "5": [720,1140], "6": [720,1200]},
  "step": 15, "leadMinutes": 60, "horizonDays": 60, "cancelHours": 12, "closedDates": []
}');

create table public.staff (
  id text primary key default gen_random_uuid()::text,
  name text not null, role text, bio text,
  active boolean not null default true,
  hours jsonb not null default '{}',
  "order" int not null default 99,
  user_id uuid references auth.users(id)
);

create table public.services (
  id text primary key default gen_random_uuid()::text,
  cat text not null default 'Herren',
  name text not null,
  duration int not null check (duration between 5 and 600),
  price int not null check (price >= 0),          -- Cent
  price_to int,
  price_mode text not null default 'fixed' check (price_mode in ('fixed','from','range')),
  staff_ids text[] not null default '{}',
  active boolean not null default true,
  "order" int not null default 99
);

-- ---------- Termine ----------
create table public.appointments (
  id text primary key default gen_random_uuid()::text,
  date date not null,
  start int not null check (start between 0 and 1439),
  duration int not null check (duration > 0),
  service_id text not null references public.services(id),
  staff_id text not null references public.staff(id),
  customer_id uuid references public.profiles(id) on delete set null,
  name text not null,
  phone text,
  note text,
  status text not null default 'booked' check (status in ('booked','cancelled')),
  source text not null default 'customer',
  history jsonb not null default '[]',
  created_at timestamptz not null default now(),
  -- Minutenbereich für die Überschneidungsprüfung
  span int4range generated always as (int4range(start, start + duration)) stored,
  -- Keine zwei aktiven Termine pro Mitarbeiter, die sich überschneiden (Datenbank-Garantie)
  constraint no_double_booking exclude using gist (staff_id with =, date with =, span with &&) where (status = 'booked')
);

create table public.blockers (
  id text primary key default gen_random_uuid()::text,
  staff_id text references public.staff(id) on delete cascade,  -- null = ganzer Salon
  date date not null,
  start int not null, "end" int not null check ("end" > start),
  reason text,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id text primary key default gen_random_uuid()::text,
  appointment_id text unique references public.appointments(id) on delete set null,
  customer_id uuid references public.profiles(id) on delete set null,
  staff_id text references public.staff(id),
  name text not null,
  rating int not null check (rating between 1 and 5),
  text text not null check (char_length(text) between 10 and 600),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  moderated_at timestamptz
);

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.appointments enable row level security;
alter table public.blockers enable row level security;
alter table public.reviews enable row level security;

-- Profile: eigenes lesen/ändern (Rolle nicht änderbar), Admin alles
create policy "profil lesen" on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy "profil ändern" on public.profiles for update using (id = auth.uid() or public.is_admin())
  with check (public.is_admin() or role = (select role from public.profiles p where p.id = auth.uid()));

-- Stammdaten: öffentlich lesbar, nur Admin schreibt
create policy "settings lesen" on public.settings for select using (true);
create policy "settings admin" on public.settings for update using (public.is_admin());
create policy "staff lesen" on public.staff for select using (true);
create policy "staff admin" on public.staff for all using (public.is_admin()) with check (public.is_admin());
create policy "services lesen" on public.services for select using (true);
create policy "services admin" on public.services for all using (public.is_admin()) with check (public.is_admin());

-- Termine: Kunde sieht nur eigene; Anlegen nur über book_appointment(); Admin alles
create policy "termine eigene" on public.appointments for select using (customer_id = auth.uid() or public.is_admin());
create policy "termine admin" on public.appointments for all using (public.is_admin()) with check (public.is_admin());
-- Kunde darf eigene Termine nur stornieren/verschieben, Prüfung der Frist in reschedule/cancel-RPCs empfohlen
create policy "termine kunde ändern" on public.appointments for update using (customer_id = auth.uid()) with check (customer_id = auth.uid());

-- Blocker: nur Admin (öffentlich nur über busy_slots ohne Grund)
create policy "blocker admin" on public.blockers for all using (public.is_admin()) with check (public.is_admin());

-- Bewertungen: freigegebene öffentlich, eigene sichtbar, Kunde legt pending an, Admin moderiert
create policy "bewertungen öffentlich" on public.reviews for select using (status = 'approved' or customer_id = auth.uid() or public.is_admin());
create policy "bewertung anlegen" on public.reviews for insert with check (
  customer_id = auth.uid() and status = 'pending'
  and exists (select 1 from public.appointments a where a.id = appointment_id and a.customer_id = auth.uid() and a.status = 'booked'
              and (a.date + make_interval(mins => a.start + a.duration)) < (now() at time zone 'Europe/Berlin')));
create policy "bewertung admin" on public.reviews for update using (public.is_admin());

-- ---------- Öffentliche Belegung ohne personenbezogene Daten ----------
create or replace function public.busy_slots(from_date date, to_date date)
returns table (id text, staff_id text, date date, start int, "end" int)
language sql stable security definer set search_path = public as $$
  select a.id, a.staff_id, a.date, a.start, a.start + a.duration from public.appointments a
   where a.status = 'booked' and a.date between from_date and to_date
  union all
  select b.id, b.staff_id, b.date, b.start, b."end" from public.blockers b
   where b.date between from_date and to_date;
$$;
grant execute on function public.busy_slots(date, date) to anon, authenticated;

-- ---------- Buchen mit Prüfung (Öffnungszeit, Vorlauf, Blocker); Doppelbuchung verhindert der Constraint ----------
create or replace function public.book_appointment(date date, start int, service_id text, staff_id text, note text default null,
  duration int default null, customer_id uuid default null, name text default null, phone text default null,
  status text default null, source text default null, history jsonb default null)
returns public.appointments
language plpgsql security definer set search_path = public as $$
declare
  s public.services; p public.profiles; cfg jsonb; hrs jsonb; r public.appointments;
  local_now timestamp := now() at time zone 'Europe/Berlin';
begin
  if auth.uid() is null then raise exception 'Bitte anmelden.'; end if;
  select * into s from public.services where services.id = book_appointment.service_id and active;
  if not found or not (book_appointment.staff_id = any (s.staff_ids)) then raise exception 'Leistung nicht verfügbar.'; end if;
  select * into p from public.profiles where id = auth.uid();
  select data into cfg from public.settings where id = 1;
  hrs := cfg->'hours'->(extract(dow from book_appointment.date)::int)::text;
  if hrs is null or hrs = 'null'::jsonb then raise exception 'An diesem Tag ist geschlossen.'; end if;
  if book_appointment.start < (hrs->>0)::int or book_appointment.start + s.duration > (hrs->>1)::int then raise exception 'Außerhalb der Öffnungszeiten.'; end if;
  if (book_appointment.date + make_interval(mins => book_appointment.start)) < local_now + make_interval(mins => (cfg->>'leadMinutes')::int) then raise exception 'Zu kurzfristig.'; end if;
  if exists (select 1 from public.blockers b where b.date = book_appointment.date and (b.staff_id is null or b.staff_id = book_appointment.staff_id)
             and int4range(b.start, b."end") && int4range(book_appointment.start, book_appointment.start + s.duration)) then
    raise exception 'Diese Zeit ist blockiert.'; end if;
  insert into public.appointments (date, start, duration, service_id, staff_id, customer_id, name, phone, note, source, history)
  values (book_appointment.date, book_appointment.start, s.duration, s.id, book_appointment.staff_id, p.id, p.name, p.phone, left(book_appointment.note, 500), 'customer',
          jsonb_build_array(jsonb_build_object('at', now(), 'by', 'customer', 'what', 'gebucht')))
  returning * into r;
  return r;
exception when exclusion_violation then raise exception 'Diese Zeit ist inzwischen vergeben.';
end $$;
grant execute on function public.book_appointment to authenticated;

create or replace function public.delete_own_account() returns void
language sql security definer set search_path = public as $$ delete from auth.users where id = auth.uid(); $$;
grant execute on function public.delete_own_account() to authenticated;

-- Admin festlegen (einmalig, nach Registrierung von Burak):
-- update public.profiles set role = 'admin' where email = 'burak@…';

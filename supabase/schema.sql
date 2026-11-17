-- =====================================================================
-- BRK Studio Plattform + Studio-Pult – Supabase-Schema (Version 2)
-- Status: vorbereitet, im Demo-Betrieb INAKTIV.
--
-- Einspielen: Supabase Dashboard -> SQL Editor -> diese Datei ausführen.
-- Danach in assets/js/app/config.js url + anon key eintragen und adapter: 'supabase'.
-- Im Frontend steht NUR der öffentliche anon key. Der service_role key gehört
-- nie in den Browser, nie ins Repository.
--
-- Sicherheitsmodell
--   * Supabase Auth (bcrypt, JWT). Rollen in public.profiles.role:
--     customer (Website-Kunde), staff (Mitarbeiter), admin (Inhaber).
--   * Jede Tabelle hat Row Level Security. Ohne passende Policy: kein Zugriff.
--   * Geldbuchungen (Bons, Storno, Monatsabschluss) laufen nur über
--     SECURITY-DEFINER-Funktionen mit Prüfung; direkte INSERTs sind gesperrt.
--   * Bons, Kassenbuch, Lagerbewegungen, Abschlüsse und Audit-Log sind
--     nur anhängbar (Trigger verbieten UPDATE/DELETE für alle Rollen).
--   * Monatssperre per Trigger: in abgeschlossenen Monaten keine Buchung.
--   * Storno nur als Gegenbon über void_bon(), höchstens einmal je Bon.
--   * Audit-Log wird von Triggern und Funktionen geschrieben, nie vom Client.
--   * CSRF: Die App nutzt keine Cookies. Jede Anfrage trägt das JWT im
--     Authorization-Header; fremde Seiten können es nicht mitsenden.
--
-- Zeiten: date + Minuten ab Mitternacht (Ortszeit Köln), Beträge in Cent.
-- Nicht enthalten: TSE (KassenSichV). Ohne zertifizierte TSE ist das kein
-- zulässiges Kassensystem. Bitte mit dem Steuerberater abstimmen.
-- =====================================================================

create extension if not exists btree_gist;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Profile, Rollen, Hilfsfunktionen
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer','staff','admin')),
  staff_id text,                      -- Verknüpfung Mitarbeiterkonto -> staff.id
  name text not null check (char_length(name) between 1 and 80),
  email text not null,
  phone text check (phone is null or char_length(phone) <= 30),
  created_at timestamptz not null default now()
);

create or replace function public.app_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'anon');
$$;
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$ select public.app_role() = 'admin'; $$;
create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$ select public.app_role() in ('admin','staff'); $$;
create or replace function public.my_staff_id() returns text
language sql stable security definer set search_path = public as $$ select staff_id from public.profiles where id = auth.uid(); $$;
create or replace function public.local_today() returns date
language sql stable as $$ select (now() at time zone 'Europe/Berlin')::date; $$;
create or replace function public.local_minutes() returns int
language sql stable as $$ select (extract(hour from now() at time zone 'Europe/Berlin') * 60 + extract(minute from now() at time zone 'Europe/Berlin'))::int; $$;
create or replace function public.ym(d date) returns text
language sql immutable as $$ select to_char(d, 'YYYY-MM'); $$;

-- Neues Konto: immer Rolle customer. Admin/Staff vergibt nur ein Admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, phone)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'name', ''), 80), new.email, left(new.raw_user_meta_data->>'phone', 30));
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Keine Selbstbeförderung: role und staff_id ändert nur ein Admin (oder der SQL Editor).
-- Bewusst SECURITY INVOKER: current_user ist hier die echte API-Rolle.
create or replace function public.guard_profile() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.role is distinct from old.role or new.staff_id is distinct from old.staff_id or new.email is distinct from old.email)
     and current_user in ('anon','authenticated') and not public.is_admin() then
    raise exception 'Rolle, Mitarbeiterzuordnung und E-Mail ändert nur ein Admin.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles for each row execute function public.guard_profile();

-- ---------------------------------------------------------------------
-- Gemeinsame Trigger: Nur anhängen, Monatssperre, Audit
-- ---------------------------------------------------------------------
create or replace function public.forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception '% ist nur anhängbar: Ändern und Löschen sind gesperrt. Korrekturen als Gegenbuchung.', tg_table_name using errcode = '42501';
end $$;

create table public.closings (
  id text primary key default 'mc_' || gen_random_uuid()::text,
  month text not null unique check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  locked_at timestamptz not null default now(),
  by uuid references auth.users(id) default auth.uid(),
  by_name text,
  totals jsonb not null default '{}',
  hash text not null
);

create or replace function public.enforce_month_lock() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.closings c where c.month = public.ym(new.date)) then
    raise exception 'Der Monat % ist abgeschlossen. Nur Korrekturbuchungen im laufenden Monat sind möglich.', public.ym(new.date) using errcode = '42501';
  end if;
  return new;
end $$;

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  by uuid default auth.uid(),
  by_name text,
  action text not null,
  entity text not null,
  entity_id text,
  detail text check (detail is null or char_length(detail) <= 600)
);
create trigger audit_append_only before update or delete on public.audit_log for each row execute function public.forbid_change();
create trigger audit_no_truncate before truncate on public.audit_log for each statement execute function public.forbid_change();

create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text, p_detail text) returns void
language sql security definer set search_path = public as $$
  insert into public.audit_log (by, by_name, action, entity, entity_id, detail)
  values (auth.uid(), (select name from public.profiles where id = auth.uid()), left(p_action, 40), left(p_entity, 40), left(p_entity_id, 80), left(p_detail, 600));
$$;

-- Automatisches Audit für Stammdaten und Rechte
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare rid text;
begin
  rid := coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', '');
  perform public.write_audit(lower(tg_op), tg_table_name, rid,
    case when tg_op = 'UPDATE' then (select string_agg(key, ', ') from jsonb_each(to_jsonb(new)) n where n.value is distinct from to_jsonb(old)->n.key) else null end);
  return null;
end $$;

-- Client-Ereignisse (Anmeldung, Export) – nur Team, Absender kommt aus dem JWT
create or replace function public.log_event(p_action text, p_entity text, p_entity_id text default null, p_detail text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_team() then raise exception 'Keine Berechtigung.' using errcode = '42501'; end if;
  if p_action not in ('anmeldung','export','kassensturz','statistik','einstellungen','no-show') then raise exception 'Unbekanntes Ereignis.'; end if;
  perform public.write_audit(p_action, p_entity, p_entity_id, p_detail);
end $$;

-- ---------------------------------------------------------------------
-- Einstellungen: öffentlich (Öffnungszeiten) und intern (Firma, DATEV)
-- ---------------------------------------------------------------------
create table public.settings (id int primary key default 1 check (id = 1), data jsonb not null);
insert into public.settings (data) values ('{
  "hours": {"0": null, "1": [720,1140], "2": [720,1080], "3": [720,1080], "4": [720,1140], "5": [720,1140], "6": [720,1200]},
  "step": 15, "leadMinutes": 60, "horizonDays": 60, "cancelHours": 12, "closedDates": []
}');
create table public.settings_private (id int primary key default 1 check (id = 1), data jsonb not null default '{}');
insert into public.settings_private (data) values ('{
  "business": {"name": "BRK Studio", "street": "Fleischmengergasse 29", "zip": "50676", "city": "Köln"},
  "datev": {"consultant": "", "client": "", "skr": "03", "fyStartMonth": 1, "accounts": {}},
  "pay": {"cash": true, "card": true, "voucher": true, "installment": true, "online": false},
  "security": {"idleMinutes": 20}
}');

-- ---------------------------------------------------------------------
-- Stammdaten
-- ---------------------------------------------------------------------
create table public.resources (
  id text primary key default 'rs_' || gen_random_uuid()::text,
  name text not null, type text not null check (type in ('chair','color','wash','other')),
  "order" int not null default 99, active boolean not null default true
);
create table public.staff (
  id text primary key default 'st_' || gen_random_uuid()::text,
  name text not null, role text, bio text,
  active boolean not null default true,
  hours jsonb not null default '{}',
  breaks jsonb,
  color text,
  resource_id text references public.resources(id) on delete set null,
  "order" int not null default 99,
  user_id uuid references auth.users(id) on delete set null
);
alter table public.profiles add constraint profiles_staff_fk foreign key (staff_id) references public.staff(id) on delete set null;

create table public.services (
  id text primary key default 'sv_' || gen_random_uuid()::text,
  cat text not null default 'Herren',
  name text not null,
  duration int not null check (duration between 5 and 600),
  price int not null check (price >= 0),
  price_to int check (price_to is null or price_to >= price),
  price_mode text not null default 'fixed' check (price_mode in ('fixed','from','range')),
  vat int not null default 19 check (vat in (0,7,19)),
  cost int not null default 0 check (cost >= 0),
  resource_type text check (resource_type in ('chair','color','wash','other')),
  staff_ids text[] not null default '{}',
  active boolean not null default true,
  "order" int not null default 99
);
create table public.products (
  id text primary key default 'pr_' || gen_random_uuid()::text,
  name text not null check (char_length(name) between 2 and 80),
  cat text not null default 'Sonstiges',
  sku text,
  price int not null check (price >= 0),
  cost int not null default 0 check (cost >= 0),
  vat int not null default 19 check (vat in (7,19)),
  stock int not null default 0 check (stock >= 0),
  min_stock int not null default 0 check (min_stock >= 0),
  target int not null default 0,
  active boolean not null default true,
  "order" int not null default 99
);
create table public.packages (
  id text primary key default 'pk_' || gen_random_uuid()::text,
  name text not null,
  items jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0),
  price int not null check (price >= 100),
  vat int not null default 19 check (vat in (7,19)),
  valid_months int not null default 12 check (valid_months between 1 and 36),
  active boolean not null default true
);

-- Bestand nur über Lagerbewegungen (Trigger), nie direkt
create or replace function public.guard_stock() returns trigger
language plpgsql as $$
begin
  if new.stock is distinct from old.stock and coalesce(current_setting('brk.stock', true), '') <> 'on' then
    raise exception 'Bestand ändert sich nur über Lagerbewegungen.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger products_stock_guard before update on public.products for each row execute function public.guard_stock();

-- ---------------------------------------------------------------------
-- Kunden, Termine, Blocker, Bewertungen
-- ---------------------------------------------------------------------
create table public.clients (
  id text primary key default 'cl_' || gen_random_uuid()::text,
  name text not null check (char_length(name) between 2 and 80),
  phone text check (phone is null or char_length(phone) <= 30),
  email text check (email is null or email = '' or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id uuid unique references auth.users(id) on delete set null,
  prefs text check (prefs is null or char_length(prefs) <= 500),
  notes text check (notes is null or char_length(notes) <= 1000),
  tags text[] not null default '{}',
  birthday date,
  consent jsonb not null default '{"email": false, "sms": false}',
  created_at timestamptz not null default now()
);

create table public.appointments (
  id text primary key default 'ap_' || gen_random_uuid()::text,
  date date not null,
  start int not null check (start between 0 and 1439),
  duration int not null check (duration > 0),
  service_id text not null references public.services(id),
  staff_id text not null references public.staff(id),
  resource_id text references public.resources(id),
  customer_id uuid references public.profiles(id) on delete set null,
  client_id text references public.clients(id) on delete set null,
  name text not null,
  phone text,
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'booked' check (status in ('booked','cancelled','noshow')),
  source text not null default 'customer',
  history jsonb not null default '[]',
  paid_bon_id text,
  deposit jsonb,
  created_at timestamptz not null default now(),
  span int4range generated always as (int4range(start, start + duration)) stored,
  constraint no_double_booking exclude using gist (staff_id with =, date with =, span with &&) where (status = 'booked')
);

create table public.blockers (
  id text primary key default 'bl_' || gen_random_uuid()::text,
  staff_id text references public.staff(id) on delete cascade,   -- null = ganzer Salon
  date date not null,
  start int not null, "end" int not null check ("end" > start),
  reason text,
  kind text not null default 'block' check (kind in ('block','absence')),
  absence_type text,
  "group" text,
  created_at timestamptz not null default now()
);

create table public.reviews (
  id text primary key default 'rv_' || gen_random_uuid()::text,
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

-- Kundenschutz: Kunden dürfen an eigenen Terminen nur Status/Zeit/Historie ändern, nicht Preis, Mitarbeiter-Zahlung o. ä.
create or replace function public.guard_appointment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_team() then return new; end if;
  if new.customer_id is distinct from old.customer_id or new.service_id is distinct from old.service_id
     or new.paid_bon_id is distinct from old.paid_bon_id or new.deposit is distinct from old.deposit
     or new.client_id is distinct from old.client_id or new.source is distinct from old.source
     or new.status not in ('booked','cancelled') then
    raise exception 'Diese Änderung ist nicht erlaubt.' using errcode = '42501';
  end if;
  if (old.date + make_interval(mins => old.start)) < (now() at time zone 'Europe/Berlin')
       + make_interval(hours => coalesce(((select data from public.settings where id = 1)->>'cancelHours')::int, 12)) then
    raise exception 'Änderungen sind bis % Stunden vorher möglich.', coalesce(((select data from public.settings where id = 1)->>'cancelHours')::int, 12);
  end if;
  return new;
end $$;
create trigger appointments_guard before update on public.appointments for each row execute function public.guard_appointment();

-- ---------------------------------------------------------------------
-- Kasse und Buchhaltung (nur anhängbar)
-- ---------------------------------------------------------------------
create sequence public.bon_no_seq start 1;

create table public.transactions (
  id text primary key default 'tx_' || gen_random_uuid()::text,
  no bigint not null unique,
  date date not null,
  time int not null check (time between 0 and 1439),
  month text not null,
  at timestamptz not null default now(),
  cashier text references public.staff(id),
  cashier_user uuid references auth.users(id) default auth.uid(),
  client_id text references public.clients(id) on delete set null,
  client_name text,
  appt_ids text[] not null default '{}',
  lines jsonb not null check (jsonb_typeof(lines) = 'array'),
  payments jsonb not null check (jsonb_typeof(payments) = 'array'),
  tips jsonb not null default '[]' check (jsonb_typeof(tips) = 'array'),
  cash_given int,
  change int,
  totals jsonb not null,
  note text check (note is null or char_length(note) <= 200),
  void_of text unique references public.transactions(id),   -- je Bon höchstens ein Storno
  void_of_no bigint,
  reason text,
  constraint month_matches check (month = to_char(date, 'YYYY-MM'))
);
create trigger tx_append_only before update or delete on public.transactions for each row execute function public.forbid_change();
create trigger tx_no_truncate before truncate on public.transactions for each statement execute function public.forbid_change();
create trigger tx_month_lock before insert on public.transactions for each row execute function public.enforce_month_lock();

create table public.cashmoves (
  id text primary key default 'mv_' || gen_random_uuid()::text,
  date date not null default public.local_today(),
  time int not null default public.local_minutes(),
  kind text not null check (kind in ('opening','deposit_in','withdrawal','bank','tip_payout','diff')),
  amount int not null check (amount <> 0),
  text text check (text is null or char_length(text) <= 80),
  by uuid references auth.users(id) default auth.uid(),
  constraint sign_ok check ((kind in ('opening','deposit_in') and amount > 0) or (kind in ('withdrawal','bank','tip_payout') and amount < 0) or kind = 'diff')
);
create trigger cash_append_only before update or delete on public.cashmoves for each row execute function public.forbid_change();
create trigger cash_month_lock before insert on public.cashmoves for each row execute function public.enforce_month_lock();

create or replace function public.cash_balance() returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sum((p->>'amount')::bigint) from public.transactions t, jsonb_array_elements(t.payments) p where p->>'method' = 'cash'), 0)
       + coalesce((select sum((x->>'amount')::bigint) from public.transactions t, jsonb_array_elements(t.tips) x where x->>'method' = 'cash'), 0)
       + coalesce((select sum(amount) from public.cashmoves), 0);
$$;
create or replace function public.guard_cashmove() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.by := auth.uid();                                     -- Absender nicht fälschbar
  new.date := public.local_today(); new.time := public.local_minutes();  -- keine Rückdatierung
  if new.kind in ('deposit_in','withdrawal','opening') and not public.is_admin() then
    raise exception 'Einlage, Entnahme und Anfangsbestand bucht nur ein Admin.' using errcode = '42501';
  end if;
  if new.kind <> 'diff' and public.cash_balance() + new.amount < 0 then
    raise exception 'So viel Bargeld ist nicht in der Kasse.';
  end if;
  return new;
end $$;
create trigger cash_guard before insert on public.cashmoves for each row execute function public.guard_cashmove();

create table public.stockmoves (
  id text primary key default 'sm_' || gen_random_uuid()::text,
  product_id text not null references public.products(id),
  date date not null default public.local_today(),
  qty int not null check (qty <> 0),
  kind text not null check (kind in ('in','out','sale','void','count')),
  bon_id text references public.transactions(id),
  note text check (note is null or char_length(note) <= 80),
  cost int check (cost is null or cost >= 0),
  by uuid references auth.users(id) default auth.uid()
);
create trigger stock_append_only before update or delete on public.stockmoves for each row execute function public.forbid_change();
create trigger stock_month_lock before insert on public.stockmoves for each row execute function public.enforce_month_lock();
create or replace function public.apply_stockmove() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('brk.stock', 'on', true);
  update public.products set stock = stock + new.qty, cost = case when new.kind = 'in' and new.cost is not null then new.cost else cost end
   where id = new.product_id;
  perform set_config('brk.stock', '', true);
  return null;   -- check (stock >= 0) bricht die Buchung ab, wenn zu wenig da ist
end $$;
create trigger stock_apply after insert on public.stockmoves for each row execute function public.apply_stockmove();
create or replace function public.guard_stockmove() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.by := auth.uid();
  if current_setting('brk.rpc', true) = 'on' then return new; end if;   -- Verkauf/Storno aus create_bon/void_bon
  new.date := public.local_today();
  if new.kind not in ('in','out','count') or new.bon_id is not null then raise exception 'Verkauf und Storno bucht nur die Kasse.' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'Lagerbuchungen nur durch Admin.' using errcode = '42501'; end if;
  return new;
end $$;
create trigger stock_guard before insert on public.stockmoves for each row execute function public.guard_stockmove();

create table public.vouchers (
  id text primary key default 'vo_' || gen_random_uuid()::text,
  code text not null unique check (code ~ '^[A-Z0-9-]{6,20}$'),
  value int not null check (value >= 500),
  issued_at date not null,
  sold_date date not null,
  expires date not null,
  buyer text, client_id text references public.clients(id) on delete set null,
  sold_bon_id text not null references public.transactions(id),
  channel text not null default 'kasse' check (channel in ('kasse','online')),
  note text
);
create trigger vouchers_append_only before update or delete on public.vouchers for each row execute function public.forbid_change();

create table public.package_cards (
  id text primary key default 'pc_' || gen_random_uuid()::text,
  package_id text not null references public.packages(id),
  name text not null,
  client_id text not null references public.clients(id),
  bon_id text not null references public.transactions(id),
  date date not null, expires date not null,
  items jsonb not null
);
create trigger cards_append_only before update or delete on public.package_cards for each row execute function public.forbid_change();

create table public.installments (
  id text primary key default 'ip_' || gen_random_uuid()::text,
  client_id text not null references public.clients(id),
  client_name text,
  bon_id text not null references public.transactions(id),
  total int not null check (total > 0),
  created_at date not null,
  schedule jsonb not null,
  note text
);
create trigger plans_append_only before update or delete on public.installments for each row execute function public.forbid_change();

create table public.attendance (
  id text primary key default 'at_' || gen_random_uuid()::text,
  staff_id text not null references public.staff(id),
  date date not null default public.local_today(),
  "in" int not null check ("in" between 0 and 1439),
  "out" int check ("out" is null or "out" > "in")
);
create or replace function public.guard_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_admin() then return new; end if;
  -- Mitarbeiter stempeln nur sich selbst, nur heute, nur zur aktuellen Uhrzeit
  if new.staff_id is distinct from public.my_staff_id() then raise exception 'Nur für dich selbst stempeln.' using errcode = '42501'; end if;
  new.date := public.local_today();
  if tg_op = 'INSERT' then new."in" := public.local_minutes(); new."out" := null;
  else
    if old."out" is not null or new."in" <> old."in" then raise exception 'Erfasste Zeiten ändert nur ein Admin.' using errcode = '42501'; end if;
    new."out" := public.local_minutes();
  end if;
  return new;
end $$;
create trigger attendance_guard before insert or update on public.attendance for each row execute function public.guard_attendance();

create trigger closings_append_only before update or delete on public.closings for each row execute function public.forbid_change();

create table public.stats (
  id text primary key default 'cs_' || gen_random_uuid()::text,
  name text not null check (char_length(name) between 2 and 60),
  metric text not null, "group" text not null, split text, period text not null,
  view text not null check (view in ('table','chart'))
);

-- Audit für Stammdaten, Rechte und Einstellungen
create trigger audit_profiles after update on public.profiles for each row execute function public.audit_row();
create trigger audit_settings after update on public.settings for each row execute function public.audit_row();
create trigger audit_settings_private after update on public.settings_private for each row execute function public.audit_row();
create trigger audit_staff after insert or update or delete on public.staff for each row execute function public.audit_row();
create trigger audit_services after insert or update or delete on public.services for each row execute function public.audit_row();
create trigger audit_products after insert or update or delete on public.products for each row execute function public.audit_row();
create trigger audit_packages after insert or update or delete on public.packages for each row execute function public.audit_row();
create trigger audit_clients after insert or update or delete on public.clients for each row execute function public.audit_row();
create trigger audit_cashmoves after insert on public.cashmoves for each row execute function public.audit_row();
create trigger audit_stockmoves after insert on public.stockmoves for each row execute function public.audit_row();

-- ---------------------------------------------------------------------
-- Kasse: Bon anlegen (einziger Weg für Umsätze)
-- p_cart: { lines:[{kind, refId, serviceId, cardId, planId, name, qty, unit, discount, staffId, code}],
--           payments:[{method, amount, ref}], tips:[{staffId, method, amount}],
--           clientId, apptIds:[], cashGiven, note, installment:{count, firstDue} }
-- Der Server rechnet alle Summen und Steuern selbst; Werte vom Client sind nur Vorschlag.
-- ---------------------------------------------------------------------
create or replace function public.create_bon(p_cart jsonb) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare
  me public.profiles; cl public.clients; t public.transactions;
  l jsonb; p jsonb; x jsonb; out_lines jsonb := '[]'; out_pay jsonb := '[]'; out_tips jsonb := '[]';
  k text; qty int; unit int; disc int; vat int; gross int; due int := 0; rev int := 0; cash int := 0;
  vats jsonb := '{}'; net_total int := 0; tax_total int := 0; paid int := 0; given int; v record;
  pr public.products; sv public.services; pk public.packages; rest int; n int; v_first date; rate int; i int; sched jsonb;
  d date := public.local_today(); mins int := public.local_minutes(); v_code text;
  rate_key text; r_gross int; r_net int;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.role not in ('admin','staff') then raise exception 'Keine Berechtigung.' using errcode = '42501'; end if;
  if jsonb_array_length(coalesce(p_cart->'lines', '[]')) = 0 then raise exception 'Der Warenkorb ist leer.'; end if;
  if jsonb_array_length(p_cart->'lines') > 60 then raise exception 'Zu viele Positionen.'; end if;
  if p_cart->>'clientId' is not null then
    select * into cl from public.clients where id = p_cart->>'clientId';
    if not found then raise exception 'Kunde nicht gefunden.'; end if;
  end if;

  for l in select * from jsonb_array_elements(p_cart->'lines') loop
    k := l->>'kind';
    qty := (l->>'qty')::int; unit := (l->>'unit')::int; disc := coalesce((l->>'discount')::int, 0);
    if qty is null or qty < 1 or qty > 99 then raise exception 'Ungültige Menge.'; end if;
    if unit is null or unit < 0 or unit > 1000000 then raise exception 'Ungültiger Preis.'; end if;
    if disc < 0 or disc > qty * unit then raise exception 'Ungültiger Rabatt.'; end if;
    vat := null;
    if k = 'service' then
      select * into sv from public.services where id = l->>'refId'; if not found then raise exception 'Leistung nicht gefunden.'; end if;
      vat := sv.vat; l := l || jsonb_build_object('serviceId', sv.id, 'name', sv.name);
    elsif k = 'product' then
      select * into pr from public.products where id = l->>'refId' for update; if not found then raise exception 'Produkt nicht gefunden.'; end if;
      if pr.stock < qty then raise exception 'Nicht genug Bestand: % (noch %).', pr.name, pr.stock; end if;
      vat := pr.vat; l := l || jsonb_build_object('name', pr.name, 'cost', pr.cost);
    elsif k = 'voucher' then
      if unit < 500 or disc <> 0 or qty <> 1 then raise exception 'Gutschein: ab 5 €, ohne Rabatt, einzeln.'; end if;
      v_code := upper(coalesce(nullif(l->>'code', ''), 'BRK-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 4)) || '-' || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 2))));
      if exists (select 1 from public.vouchers where vouchers.code = v_code) then raise exception 'Gutscheincode existiert schon.'; end if;
      l := l || jsonb_build_object('code', v_code, 'refId', v_code, 'name', 'Gutschein ' || v_code);
    elsif k = 'package' then
      select * into pk from public.packages where id = l->>'refId' and active; if not found then raise exception 'Paket nicht gefunden.'; end if;
      if cl.id is null then raise exception 'Beauty-Pakete bitte einem Kunden zuordnen.'; end if;
      vat := pk.vat; l := l || jsonb_build_object('name', pk.name);
    elsif k = 'package_use' then
      select (it->>'total')::int - coalesce((select sum((ul->>'qty')::int) from public.transactions tt, jsonb_array_elements(tt.lines) ul
                where ul->>'kind' = 'package_use' and ul->>'cardId' = c.id and ul->>'serviceId' = it->>'serviceId'), 0) as left_n, c.expires
        into v from public.package_cards c, jsonb_array_elements(c.items) it
       where c.id = l->>'cardId' and it->>'serviceId' = l->>'serviceId'
         and not exists (select 1 from public.transactions vt where vt.void_of = c.bon_id);
      if v is null or v.left_n < qty or v.expires < d then raise exception 'Im Paket ist dafür nichts mehr offen.'; end if;
      unit := 0; disc := 0; vat := 19;
    elsif k = 'installment' then
      select i2.total - coalesce((select sum((il->>'qty')::int * (il->>'unit')::int) from public.transactions tt, jsonb_array_elements(tt.lines) il
                where il->>'kind' = 'installment' and il->>'refId' = i2.id), 0) as open_n into v
        from public.installments i2 where i2.id = coalesce(l->>'planId', l->>'refId');
      if v is null or qty * unit - disc > v.open_n then raise exception 'Rate ist höher als der offene Betrag.'; end if;
      l := l || jsonb_build_object('refId', coalesce(l->>'planId', l->>'refId'));
    elsif k = 'deposit' then
      if not exists (select 1 from public.appointments a where a.id = l->>'refId' and a.deposit is null and a.status = 'booked') then
        raise exception 'Anzahlung nicht möglich.'; end if;
    elsif k = 'fee' then vat := 19;
    else raise exception 'Unbekannte Position: %', k;
    end if;
    gross := qty * unit - disc;
    l := l || jsonb_build_object('qty', qty, 'unit', unit, 'discount', disc, 'vat', vat);
    out_lines := out_lines || jsonb_build_array(l);
    due := due + gross;
    if k in ('service','product','package','package_use','fee') then
      rev := rev + gross;
      vats := jsonb_set(vats, array[vat::text], to_jsonb(coalesce((vats->>vat::text)::int, 0) + gross));
    end if;
  end loop;

  -- USt. je Satz auf die Bonsumme: netto = round(brutto * 100 / (100 + satz))
  for rate_key, r_gross in select key, value::int from jsonb_each_text(vats) loop
    r_net := round(r_gross * 100.0 / (100 + rate_key::int));
    net_total := net_total + r_net; tax_total := tax_total + (r_gross - r_net);
    vats := jsonb_set(vats, array[rate_key], jsonb_build_object('gross', r_gross, 'net', r_net, 'tax', r_gross - r_net));
  end loop;

  for p in select * from jsonb_array_elements(coalesce(p_cart->'payments', '[]')) loop
    if (p->>'amount')::int is null or (p->>'amount')::int <= 0 then raise exception 'Ungültiger Zahlbetrag.'; end if;
    case p->>'method'
      when 'cash' then cash := cash + (p->>'amount')::int;
      when 'card' then null;
      when 'voucher' then
        select vo.*, coalesce((select sum((pp->>'amount')::int) from public.transactions tt, jsonb_array_elements(tt.payments) pp
                 where pp->>'method' = 'voucher' and pp->>'ref' = vo.code), 0) as used_n,
               exists (select 1 from public.transactions vt where vt.void_of = vo.sold_bon_id) as cancelled
          into v from public.vouchers vo where vo.code = upper(p->>'ref') for update;
        if v is null then raise exception 'Gutschein ist unbekannt.'; end if;
        if v.cancelled or v.expires < d then raise exception 'Gutschein ist abgelaufen oder storniert.'; end if;
        if (p->>'amount')::int > v.value - v.used_n then raise exception 'Gutschein hat nur noch % €.', replace(to_char((v.value - v.used_n) / 100.0, 'FM999990.00'), '.', ','); end if;
        p := p || jsonb_build_object('ref', v.code);
      when 'deposit' then
        if not exists (select 1 from public.appointments a where a.id = p->>'ref' and (a.deposit->>'amount')::int >= (p->>'amount')::int
                       + coalesce((select sum((pp->>'amount')::int) from public.transactions tt, jsonb_array_elements(tt.payments) pp where pp->>'method' = 'deposit' and pp->>'ref' = a.id), 0)) then
          raise exception 'Anzahlung ist nicht (mehr) vorhanden.'; end if;
      when 'installment' then if cl.id is null then raise exception 'Ratenzahlung nur mit Kunde.'; end if;
      else raise exception 'Zahlart nicht verfügbar: %', p->>'method';
    end case;
    paid := paid + (p->>'amount')::int;
    out_pay := out_pay || jsonb_build_array(jsonb_build_object('method', p->>'method', 'amount', (p->>'amount')::int, 'ref', p->>'ref'));
  end loop;
  if paid <> due then raise exception 'Zahlungen (% ct) entsprechen nicht dem Betrag (% ct).', paid, due; end if;

  for x in select * from jsonb_array_elements(coalesce(p_cart->'tips', '[]')) loop
    if (x->>'amount')::int <= 0 or (x->>'amount')::int > 50000 or x->>'method' not in ('cash','card')
       or not exists (select 1 from public.staff s where s.id = x->>'staffId') then raise exception 'Ungültiges Trinkgeld.'; end if;
    out_tips := out_tips || jsonb_build_array(jsonb_build_object('staffId', x->>'staffId', 'method', x->>'method', 'amount', (x->>'amount')::int));
  end loop;

  given := (p_cart->>'cashGiven')::int;
  if given is not null and given < cash + coalesce((select sum((y->>'amount')::int) from jsonb_array_elements(out_tips) y where y->>'method' = 'cash'), 0) then
    raise exception 'Gegebener Betrag reicht nicht.'; end if;

  perform set_config('brk.rpc', 'on', true);
  insert into public.transactions (no, date, time, month, cashier, client_id, client_name, appt_ids, lines, payments, tips, cash_given, change, totals, note)
  values (nextval('public.bon_no_seq'), d, mins, to_char(d, 'YYYY-MM'), coalesce(me.staff_id, (select id from public.staff order by "order" limit 1)),
          cl.id, coalesce(cl.name, 'Laufkundschaft'),
          coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p_cart->'apptIds', '[]'))), '{}'),
          out_lines, out_pay, out_tips, given,
          case when given is null then null else given - cash - coalesce((select sum((y->>'amount')::int) from jsonb_array_elements(out_tips) y where y->>'method' = 'cash'), 0) end,
          jsonb_build_object('due', due, 'revenue', rev, 'net', net_total, 'tax', tax_total, 'other', due - rev, 'vat', vats),
          left(p_cart->>'note', 200))
  returning * into t;

  for l in select * from jsonb_array_elements(t.lines) loop
    if l->>'kind' = 'product' then
      insert into public.stockmoves (product_id, date, qty, kind, bon_id, note, cost) values (l->>'refId', d, -(l->>'qty')::int, 'sale', t.id, 'Bon ' || t.no, (l->>'cost')::int);
    elsif l->>'kind' = 'voucher' then
      insert into public.vouchers (code, value, issued_at, sold_date, expires, buyer, client_id, sold_bon_id, channel)
      values (l->>'code', (l->>'unit')::int, d, d, make_date(extract(year from d)::int + 3, 12, 31), cl.name, cl.id, t.id, 'kasse');
    elsif l->>'kind' = 'package' then
      select * into pk from public.packages where id = l->>'refId';
      for i in 1..(l->>'qty')::int loop
        insert into public.package_cards (package_id, name, client_id, bon_id, date, expires, items)
        values (pk.id, pk.name, cl.id, t.id, d, d + pk.valid_months * 30,
                (select jsonb_agg(jsonb_build_object('serviceId', it->>'serviceId', 'total', (it->>'count')::int)) from jsonb_array_elements(pk.items) it));
      end loop;
    elsif l->>'kind' = 'deposit' then
      update public.appointments set deposit = jsonb_build_object('amount', (l->>'qty')::int * (l->>'unit')::int - (l->>'discount')::int, 'bonId', t.id, 'paidAt', d) where id = l->>'refId';
    end if;
  end loop;

  select (pp->>'amount')::int into rest from jsonb_array_elements(t.payments) pp where pp->>'method' = 'installment';
  if rest is not null then
    n := coalesce((p_cart->'installment'->>'count')::int, 0);
    if n < 2 or n > 12 then raise exception 'Anzahl Raten 2 bis 12.'; end if;
    v_first := coalesce((p_cart->'installment'->>'firstDue')::date, d + 30);
    if v_first < d or v_first > d + 90 then raise exception 'Erste Rate innerhalb von 90 Tagen.'; end if;
    rate := floor(rest / n / 100.0) * 100; sched := '[]';
    for i in 0..n - 1 loop
      sched := sched || jsonb_build_array(jsonb_build_object('due', (v_first + make_interval(months => i))::date, 'amount', case when i = n - 1 then rest - rate * (n - 1) else rate end));
    end loop;
    insert into public.installments (client_id, client_name, bon_id, total, created_at, schedule, note) values (cl.id, cl.name, t.id, rest, d, sched, 'Bon ' || t.no);
  end if;

  update public.appointments set paid_bon_id = t.id where id = any (t.appt_ids);
  perform public.write_audit('kassiert', 'bon', t.id, 'Bon ' || t.no || ' · ' || replace(to_char(due / 100.0, 'FM9999990.00'), '.', ',') || ' €');
  perform set_config('brk.rpc', '', true);
  return t;
end $$;

-- Storno: Gegenbon mit negativen Beträgen, Original bleibt unverändert
create or replace function public.void_bon(p_id text, p_reason text) returns public.transactions
language plpgsql security definer set search_path = public as $$
declare o public.transactions; t public.transactions; l jsonb; neg jsonb;
  d date := public.local_today();
begin
  if not public.is_admin() then raise exception 'Storno nur durch Admin.' using errcode = '42501'; end if;
  if char_length(coalesce(trim(p_reason), '')) < 3 then raise exception 'Bitte einen Grund angeben.'; end if;
  select * into o from public.transactions where id = p_id for update;
  if not found then raise exception 'Bon nicht gefunden.'; end if;
  if o.void_of is not null then raise exception 'Ein Stornobeleg kann nicht storniert werden.'; end if;
  if exists (select 1 from public.transactions where void_of = o.id) then raise exception 'Dieser Bon ist bereits storniert.'; end if;
  neg := jsonb_build_object(
    'lines', (select coalesce(jsonb_agg(e || jsonb_build_object('qty', -(e->>'qty')::int)), '[]') from jsonb_array_elements(o.lines) e),
    'payments', (select coalesce(jsonb_agg(e || jsonb_build_object('amount', -(e->>'amount')::int)), '[]') from jsonb_array_elements(o.payments) e),
    'tips', (select coalesce(jsonb_agg(e || jsonb_build_object('amount', -(e->>'amount')::int)), '[]') from jsonb_array_elements(o.tips) e));
  perform set_config('brk.rpc', 'on', true);
  insert into public.transactions (no, date, time, month, cashier, client_id, client_name, appt_ids, lines, payments, tips, totals, note, void_of, void_of_no, reason)
  values (nextval('public.bon_no_seq'), d, public.local_minutes(), to_char(d, 'YYYY-MM'),
          coalesce((select staff_id from public.profiles where id = auth.uid()), o.cashier), o.client_id, o.client_name, o.appt_ids,
          neg->'lines', neg->'payments', neg->'tips',
          jsonb_build_object('due', -(o.totals->>'due')::int, 'revenue', -(o.totals->>'revenue')::int, 'net', -(o.totals->>'net')::int,
                             'tax', -(o.totals->>'tax')::int, 'other', -(o.totals->>'other')::int,
                             'vat', (select coalesce(jsonb_object_agg(key, jsonb_build_object('gross', -(value->>'gross')::int, 'net', -(value->>'net')::int, 'tax', -(value->>'tax')::int)), '{}') from jsonb_each(o.totals->'vat'))),
          'Storno', o.id, o.no, left(p_reason, 120))
  returning * into t;
  for l in select * from jsonb_array_elements(o.lines) loop
    if l->>'kind' = 'product' then
      insert into public.stockmoves (product_id, date, qty, kind, bon_id, note) values (l->>'refId', d, (l->>'qty')::int, 'void', t.id, 'Storno Bon ' || o.no);
    elsif l->>'kind' = 'deposit' then update public.appointments set deposit = null where id = l->>'refId';
    end if;
  end loop;
  update public.appointments set paid_bon_id = null where id = any (o.appt_ids);
  perform public.write_audit('storniert', 'bon', o.id, 'Bon ' || o.no || ' storniert mit Bon ' || t.no || ': ' || left(p_reason, 120));
  perform set_config('brk.rpc', '', true);
  return t;
end $$;

-- Monatsabschluss: nur abgelaufene Monate, der Reihe nach, mit Prüfsumme
create or replace function public.close_month(p_month text) returns public.closings
language plpgsql security definer set search_path = public as $$
declare c public.closings; prev text; h text; tot jsonb;
begin
  if not public.is_admin() then raise exception 'Monatsabschluss nur durch Admin.' using errcode = '42501'; end if;
  if p_month !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Ungültiger Monat.'; end if;
  if p_month >= to_char(public.local_today(), 'YYYY-MM') then raise exception 'Abschließen geht erst nach Monatsende.'; end if;
  if exists (select 1 from public.closings where month = p_month) then raise exception 'Dieser Monat ist bereits abgeschlossen.'; end if;
  prev := to_char(to_date(p_month || '-01', 'YYYY-MM-DD') - interval '1 month', 'YYYY-MM');
  if exists (select 1 from public.transactions where month = prev) and not exists (select 1 from public.closings where month = prev) then
    raise exception 'Bitte zuerst % abschließen.', prev; end if;
  select encode(digest(coalesce(string_agg(no || ':' || (totals->>'due'), '|' order by no), ''), 'sha256'), 'hex'),
         jsonb_build_object('gross', coalesce(sum((totals->>'revenue')::int), 0), 'tax', coalesce(sum((totals->>'tax')::int), 0), 'bons', count(*) filter (where void_of is null))
    into h, tot from public.transactions where month = p_month;
  insert into public.closings (month, by, by_name, totals, hash)
  values (p_month, auth.uid(), (select name from public.profiles where id = auth.uid()), tot, h) returning * into c;
  perform public.write_audit('monatsabschluss', 'closing', c.id, p_month || ' gesperrt · Prüfsumme ' || left(h, 12));
  return c;
end $$;

-- ---------------------------------------------------------------------
-- Öffentliche Belegung ohne personenbezogene Daten + Buchen
-- ---------------------------------------------------------------------
create or replace function public.busy_slots(from_date date, to_date date)
returns table (id text, staff_id text, date date, start int, "end" int)
language sql stable security definer set search_path = public as $$
  select a.id, a.staff_id, a.date, a.start, a.start + a.duration from public.appointments a
   where a.status = 'booked' and a.date between from_date and least(to_date, from_date + 120)
  union all
  select b.id, b.staff_id, b.date, b.start, b."end" from public.blockers b
   where b.date between from_date and least(to_date, from_date + 120)
  union all   -- tägliche Pausen
  select 'pause-' || s.id || '-' || g::date, s.id, g::date, (s.breaks->'all'->>0)::int, (s.breaks->'all'->>1)::int
    from public.staff s, generate_series(from_date, least(to_date, from_date + 120), interval '1 day') g
   where s.breaks ? 'all';
$$;

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
  if book_appointment.date > local_now::date + (cfg->>'horizonDays')::int then raise exception 'So weit im Voraus noch nicht buchbar.'; end if;
  if exists (select 1 from public.blockers b where b.date = book_appointment.date and (b.staff_id is null or b.staff_id = book_appointment.staff_id)
             and int4range(b.start, b."end") && int4range(book_appointment.start, book_appointment.start + s.duration)) then
    raise exception 'Diese Zeit ist blockiert.'; end if;
  if (select count(*) from public.appointments a where a.customer_id = auth.uid() and a.status = 'booked' and a.date >= local_now::date) >= 5 then
    raise exception 'Höchstens 5 offene Termine pro Konto.'; end if;
  insert into public.appointments (date, start, duration, service_id, staff_id, customer_id, name, phone, note, source, history)
  values (book_appointment.date, book_appointment.start, s.duration, s.id, book_appointment.staff_id, p.id, p.name, p.phone, left(book_appointment.note, 500), 'customer',
          jsonb_build_array(jsonb_build_object('at', now(), 'by', 'customer', 'what', 'gebucht')))
  returning * into r;
  return r;
exception when exclusion_violation then raise exception 'Diese Zeit ist inzwischen vergeben.';
end $$;

create or replace function public.delete_own_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.app_role() <> 'customer' then raise exception 'Team-Konten löscht nur ein Admin.'; end if;
  delete from auth.users where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------
-- Row Level Security: jede Tabelle, Standard = kein Zugriff
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.settings_private enable row level security;
alter table public.resources enable row level security;
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.products enable row level security;
alter table public.packages enable row level security;
alter table public.clients enable row level security;
alter table public.appointments enable row level security;
alter table public.blockers enable row level security;
alter table public.reviews enable row level security;
alter table public.transactions enable row level security;
alter table public.cashmoves enable row level security;
alter table public.stockmoves enable row level security;
alter table public.vouchers enable row level security;
alter table public.package_cards enable row level security;
alter table public.installments enable row level security;
alter table public.attendance enable row level security;
alter table public.closings enable row level security;
alter table public.audit_log enable row level security;
alter table public.stats enable row level security;

-- Profile: eigenes lesen/ändern; Team liest Namen der Kollegen; Admin alles
create policy profiles_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin() or (public.is_team() and role in ('staff','admin')));
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

-- Öffentliche Stammdaten (Website): lesen für alle, schreiben nur Admin
create policy settings_read on public.settings for select to anon, authenticated using (true);
create policy settings_write on public.settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy staff_read on public.staff for select to anon, authenticated using (true);
create policy staff_write on public.staff for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy services_read on public.services for select to anon, authenticated using (true);
create policy services_write on public.services for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Interne Stammdaten: Team liest, Admin schreibt
create policy settings_private_read on public.settings_private for select to authenticated using (public.is_team());
create policy settings_private_write on public.settings_private for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy resources_read on public.resources for select to authenticated using (public.is_team());
create policy resources_write on public.resources for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy products_read on public.products for select to authenticated using (public.is_team());
create policy products_insert on public.products for insert to authenticated with check (public.is_admin() and stock = 0);
create policy products_update on public.products for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy packages_read on public.packages for select to authenticated using (public.is_team());
create policy packages_write on public.packages for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy stats_all on public.stats for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Kundenkartei: Team; Kunde sieht nur die eigene Karte; Löschen nur Admin
create policy clients_read on public.clients for select to authenticated using (public.is_team() or user_id = auth.uid());
create policy clients_insert on public.clients for insert to authenticated with check (public.is_team());
create policy clients_update on public.clients for update to authenticated using (public.is_team()) with check (public.is_team());
create policy clients_delete on public.clients for delete to authenticated using (public.is_admin());

-- Termine: Kunde eigene (Anlegen nur über book_appointment), Team alle
create policy appts_read on public.appointments for select to authenticated using (customer_id = auth.uid() or public.is_team());
create policy appts_team_insert on public.appointments for insert to authenticated with check (public.is_team());
create policy appts_update on public.appointments for update to authenticated using (customer_id = auth.uid() or public.is_team()) with check (customer_id = auth.uid() or public.is_team());
create policy appts_delete on public.appointments for delete to authenticated using (public.is_admin());

-- Blocker/Abwesenheiten: Team liest, Admin schreibt, Mitarbeiter eigene Blocker
create policy blockers_read on public.blockers for select to authenticated using (public.is_team());
create policy blockers_admin on public.blockers for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy blockers_own on public.blockers for insert to authenticated with check (public.app_role() = 'staff' and staff_id = public.my_staff_id() and kind = 'block');

-- Bewertungen
create policy reviews_read on public.reviews for select to anon, authenticated using (status = 'approved' or customer_id = auth.uid() or public.is_team());
create policy reviews_insert on public.reviews for insert to authenticated with check (
  customer_id = auth.uid() and status = 'pending'
  and exists (select 1 from public.appointments a where a.id = appointment_id and a.customer_id = auth.uid() and a.status = 'booked'
              and (a.date + make_interval(mins => a.start + a.duration)) < (now() at time zone 'Europe/Berlin')));
create policy reviews_moderate on public.reviews for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Buchhaltung: Team liest; Schreiben nur über Funktionen bzw. geprüfte Inserts
create policy tx_read on public.transactions for select to authenticated using (public.is_team());
create policy cash_read on public.cashmoves for select to authenticated using (public.is_team());
create policy cash_insert on public.cashmoves for insert to authenticated with check (public.is_team());
create policy stock_read on public.stockmoves for select to authenticated using (public.is_team());
create policy stock_insert on public.stockmoves for insert to authenticated with check (public.is_admin());
create policy vouchers_read on public.vouchers for select to authenticated using (public.is_team());
create policy cards_read on public.package_cards for select to authenticated using (public.is_team() or client_id in (select id from public.clients where user_id = auth.uid()));
create policy plans_read on public.installments for select to authenticated using (public.is_team() or client_id in (select id from public.clients where user_id = auth.uid()));
create policy closings_read on public.closings for select to authenticated using (public.is_team());
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());

-- Anwesenheit: Team liest; Stempeln eigene (Trigger prüft), Admin alles
create policy attendance_read on public.attendance for select to authenticated using (public.is_team());
create policy attendance_insert on public.attendance for insert to authenticated with check (public.is_team());
create policy attendance_update on public.attendance for update to authenticated using (public.is_admin() or staff_id = public.my_staff_id()) with check (public.is_admin() or staff_id = public.my_staff_id());

-- ---------------------------------------------------------------------
-- Rechte auf Tabellen und Funktionen (zusätzlich zu RLS, Verteidigung in der Tiefe)
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
grant select on public.settings, public.staff, public.services, public.reviews to anon;
revoke all on all sequences in schema public from anon, authenticated;
revoke truncate, references, trigger on all tables in schema public from authenticated;

revoke execute on all functions in schema public from public, anon;
grant execute on function public.busy_slots(date, date) to anon, authenticated;
grant execute on function public.book_appointment(date, int, text, text, text, int, uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.delete_own_account() to authenticated;
grant execute on function public.create_bon(jsonb) to authenticated;
grant execute on function public.void_bon(text, text) to authenticated;
grant execute on function public.close_month(text) to authenticated;
grant execute on function public.log_event(text, text, text, text) to authenticated;
grant execute on function public.app_role(), public.is_admin(), public.is_team(), public.my_staff_id(), public.local_today(), public.local_minutes(), public.ym(date), public.cash_balance() to authenticated;
-- interne Helfer nicht direkt aufrufbar
revoke execute on function public.write_audit(text, text, text, text) from authenticated;

-- ---------------------------------------------------------------------
-- Rollen vergeben (einmalig, nach Registrierung, im SQL Editor):
--   update public.profiles set role = 'admin' where email = 'inhaber@…';
--   update public.profiles set role = 'staff', staff_id = '<staff.id>' where email = 'mitarbeiter@…';
-- Supabase Auth-Einstellungen (Dashboard -> Authentication):
--   * Passwortregeln: min. 10 Zeichen, Klein/Groß/Ziffer/Sonderzeichen, Leaked-Password-Schutz an
--   * Rate Limits für Anmeldung und Registrierung aktiv lassen, CAPTCHA einschalten
--   * E-Mail-Bestätigung an, JWT-Ablauf 1 h, Session-Inaktivität (z. B. 8 h) setzen
--   * MFA (TOTP) für Admin- und Mitarbeiterkonten aktivieren
-- =====================================================================

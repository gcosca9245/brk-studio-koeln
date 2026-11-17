-- Test des Supabase-Schemas gegen lokales PostgreSQL mit Auth-Stub (nur QA, nicht für Produktion)
\set ON_ERROR_STOP 0
\pset footer off
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-0000000000a1', 'burak@x.de', '{"name":"Burak"}'),
 ('00000000-0000-0000-0000-0000000000b2', 'angelo@x.de', '{"name":"Angelo"}'),
 ('00000000-0000-0000-0000-0000000000c3', 'kunde@x.de', '{"name":"Kunde"}');
insert into public.staff (id, name) values ('st_burak', 'Burak'), ('st_angelo', 'Angelo');
update public.profiles set role = 'admin', staff_id = 'st_burak' where email = 'burak@x.de';
update public.profiles set role = 'staff', staff_id = 'st_angelo' where email = 'angelo@x.de';
insert into public.services (id, name, duration, price, vat, staff_ids) values ('sv_cut', 'Haarschnitt', 30, 3500, 19, '{st_burak,st_angelo}');
insert into public.products (id, name, price, cost, vat) values ('pr_paste', 'Paste', 2200, 900, 19), ('pr_bean', 'Bohnen', 1200, 600, 7);
select set_config('brk.stock', 'on', false); update public.products set stock = 5; select set_config('brk.stock', '', false);
insert into public.clients (id, name, user_id) values ('cl_k', 'Kunde K.', '00000000-0000-0000-0000-0000000000c3');
-- Vormonat mit einem Bon (direkt als Eigentümer, Datum in der Vergangenheit)
insert into public.transactions (no, date, time, month, lines, payments, tips, totals) values
 (nextval('bon_no_seq'), (date_trunc('month', now()) - interval '10 days')::date, 700, to_char(now() - interval '1 month' - interval '9 days' + interval '9 days' - interval '0 day', 'YYYY-MM'), '[]', '[]', '[]', '{"due":0,"revenue":0,"tax":0}');

create temp table r (n serial, test text, ok boolean, info text);
grant all on r to authenticated, anon; grant all on sequence r_n_seq to authenticated, anon;

create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false); $$;

-- ===== Mitarbeiter Angelo =====
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b2');
do $$ declare t public.transactions; begin
  t := public.create_bon('{"lines":[{"kind":"service","refId":"sv_cut","qty":1,"unit":3500,"discount":0,"staffId":"st_angelo"},{"kind":"product","refId":"pr_paste","qty":2,"unit":2200,"discount":400}],
     "payments":[{"method":"cash","amount":7500}],"tips":[{"staffId":"st_angelo","method":"cash","amount":500}],"cashGiven":8000}');
  insert into r (test, ok, info) values ('Mitarbeiter kassiert Bon', t.no > 0, 'Bon ' || t.no || ' due ' || (t.totals->>'due'));
  insert into r (test, ok, info) values ('Server rechnet USt 19 %', (t.totals->'vat'->'19'->>'tax')::int = 7500 - round(7500*100.0/119), t.totals::text);
  insert into r (test, ok, info) values ('Rückgeld inkl. Trinkgeld', t.change = 0, 'change ' || t.change);
  insert into r (test, ok, info) values ('Trinkgeld am Bon, keine Umsatzposition', (t.tips->0->>'amount')::int = 500 and (t.totals->>'revenue')::int = 7500, t.tips::text);
end $$;
do $$ begin perform public.create_bon('{"lines":[{"kind":"service","refId":"sv_cut","qty":1,"unit":3500}],"payments":[{"method":"cash","amount":3000}]}');
  insert into r (test, ok) values ('Summenprüfung', false);
exception when others then insert into r (test, ok, info) values ('Zahlung ≠ Betrag wird abgelehnt', true, sqlerrm); end $$;
do $$ begin perform public.create_bon('{"lines":[{"kind":"product","refId":"pr_paste","qty":9,"unit":2200}],"payments":[{"method":"card","amount":19800}]}');
  insert into r (test, ok) values ('Bestand', false);
exception when others then insert into r (test, ok, info) values ('Zu wenig Bestand wird abgelehnt', true, sqlerrm); end $$;
insert into r (test, ok, info) select 'Lager reduziert (5 -> 3)', stock = 3, stock::text from public.products where id = 'pr_paste';
do $$ declare s public.transactions; c text; u public.transactions; v int; begin
  s := public.create_bon('{"lines":[{"kind":"voucher","qty":1,"unit":5000,"code":"BRK-TEST-01"}],"payments":[{"method":"card","amount":5000}]}');
  insert into r (test, ok, info) values ('Gutscheinverkauf ohne USt', (s.totals->>'tax')::int = 0 and (s.totals->>'revenue')::int = 0, s.totals::text);
  u := public.create_bon('{"lines":[{"kind":"service","refId":"sv_cut","qty":1,"unit":2000}],"payments":[{"method":"voucher","ref":"BRK-TEST-01","amount":2000}]}');
  insert into r (test, ok, info) values ('Einlösung mit USt', (u.totals->>'tax')::int > 0, u.totals::text);
  begin perform public.create_bon('{"lines":[{"kind":"service","refId":"sv_cut","qty":1,"unit":3500}],"payments":[{"method":"voucher","ref":"BRK-TEST-01","amount":3500}]}');
    insert into r (test, ok) values ('Gutschein-Überzug', false);
  exception when others then insert into r (test, ok, info) values ('Gutschein-Überzug abgelehnt (Rest 30 €)', sqlerrm like '%30,00%' or sqlerrm like '%30.00%', sqlerrm); end;
end $$;
do $$ begin perform public.void_bon((select id from public.transactions order by no desc limit 1), 'Test');
  insert into r (test, ok) values ('Mitarbeiter-Storno', false);
exception when others then insert into r (test, ok, info) values ('Mitarbeiter darf nicht stornieren', true, sqlerrm); end $$;
do $$ begin update public.profiles set role = 'admin' where id = auth.uid(); insert into r (test, ok) values ('Selbstbeförderung', false);
exception when others then insert into r (test, ok, info) values ('Keine Selbstbeförderung zum Admin', true, sqlerrm); end $$;
do $$ begin insert into public.transactions (no, date, time, month, lines, payments, totals) values (999, current_date, 1, to_char(current_date,'YYYY-MM'), '[]', '[]', '{}');
  insert into r (test, ok) values ('Direkt-Insert Bon', false);
exception when others then insert into r (test, ok, info) values ('Direkter Bon-Insert gesperrt (nur RPC)', true, sqlerrm); end $$;
do $$ begin update public.products set stock = 99 where id = 'pr_paste'; insert into r (test, ok, info) values ('Bestand direkt ändern', (select stock from public.products where id = 'pr_paste') <> 99, 'keine Zeile geändert');
exception when others then insert into r (test, ok, info) values ('Bestand nicht direkt änderbar', true, sqlerrm); end $$;
do $$ begin insert into public.cashmoves (kind, amount, text) values ('withdrawal', -100, 'x'); insert into r (test, ok) values ('Entnahme Mitarbeiter', false);
exception when others then insert into r (test, ok, info) values ('Entnahme nur Admin', true, sqlerrm); end $$;
do $$ begin insert into public.cashmoves (kind, amount, text) values ('tip_payout', -500, 'Angelo'); insert into r (test, ok, info) values ('Trinkgeld-Auszahlung ins Kassenbuch', true, 'Bestand ' || public.cash_balance());
exception when others then insert into r (test, ok, info) values ('Trinkgeld-Auszahlung', false, sqlerrm); end $$;
do $$ begin insert into public.cashmoves (kind, amount, text) values ('bank', -999999, 'x'); insert into r (test, ok) values ('Kasse negativ', false);
exception when others then insert into r (test, ok, info) values ('Kasse kann nicht negativ werden', true, sqlerrm); end $$;
do $$ declare n int; begin select count(*) into n from public.audit_log; insert into r (test, ok, info) values ('Audit-Log für Mitarbeiter unsichtbar', n = 0, n::text); end $$;
do $$ begin insert into public.audit_log (action, entity) values ('fake', 'x'); insert into r (test, ok) values ('Audit-Insert Client', false);
exception when others then insert into r (test, ok, info) values ('Audit-Log nicht vom Client beschreibbar', true, sqlerrm); end $$;

-- ===== Kunde =====
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c3');
do $$ declare n int; begin select count(*) into n from public.transactions; insert into r (test, ok, info) values ('Kunde sieht keine Bons', n = 0, n::text); end $$;
do $$ declare n int; begin select count(*) into n from public.clients; insert into r (test, ok, info) values ('Kunde sieht nur eigene Karteikarte', n = 1, n::text); end $$;
do $$ begin perform public.create_bon('{"lines":[{"kind":"fee","qty":1,"unit":100}],"payments":[{"method":"cash","amount":100}]}'); insert into r (test, ok) values ('Kunde kassiert', false);
exception when others then insert into r (test, ok, info) values ('Kunde kann nicht kassieren', true, sqlerrm); end $$;
do $$ declare n int; begin select count(*) into n from public.settings_private; insert into r (test, ok, info) values ('Kunde sieht keine Firmen-/DATEV-Daten', n = 0, n::text); end $$;
reset role;
set role anon; select pg_temp.as_user('');
do $$ begin perform count(*) from public.clients; insert into r (test, ok) values ('anon Kunden', false);
exception when others then insert into r (test, ok, info) values ('Ohne Login kein Zugriff auf Kundendaten', true, sqlerrm); end $$;
do $$ declare n int; begin select count(*) into n from public.busy_slots(current_date, current_date + 7); insert into r (test, ok, info) values ('Öffentliche Belegung ohne Namen abrufbar', true, n || ' Zeilen'); end $$;
reset role;

-- ===== Admin =====
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
do $$ declare o public.transactions; v public.transactions; begin
  select * into o from public.transactions where (lines->0->>'kind') = 'service' and (tips->0) is not null order by no limit 1;
  v := public.void_bon(o.id, 'Fehlbuchung');
  insert into r (test, ok, info) values ('Storno als Gegenbon', v.void_of = o.id and (v.totals->>'due')::int = -(o.totals->>'due')::int, 'Bon ' || v.no || ' ' || (v.totals->>'due'));
  insert into r (test, ok, info) select 'Storno bucht Lager zurück', stock = 5, stock::text from public.products where id = 'pr_paste';
  begin perform public.void_bon(o.id, 'nochmal'); insert into r (test, ok) values ('Doppelstorno', false);
  exception when others then insert into r (test, ok, info) values ('Kein doppeltes Storno', true, sqlerrm); end;
  begin perform public.void_bon(v.id, 'storno vom storno'); insert into r (test, ok) values ('Storno vom Storno', false);
  exception when others then insert into r (test, ok, info) values ('Stornobeleg nicht stornierbar', true, sqlerrm); end;
end $$;
do $$ begin update public.transactions set note = 'x'; insert into r (test, ok, info) values ('Bon ändern über API: keine Policy, keine Zeile', not exists (select 1 from public.transactions where note = 'x'), 'RLS');
exception when others then insert into r (test, ok, info) values ('Bons nicht änderbar (auch Admin)', true, sqlerrm); end $$;
do $$ begin delete from public.cashmoves; insert into r (test, ok, info) values ('Kassenbuch löschen', (select count(*) from public.cashmoves) > 0, 'keine Zeile gelöscht');
exception when others then insert into r (test, ok, info) values ('Kassenbuch nicht löschbar', true, sqlerrm); end $$;
do $$ declare c public.closings; m text := to_char(now() - interval '1 month', 'YYYY-MM'); begin
  begin perform public.close_month(to_char(now(), 'YYYY-MM')); insert into r (test, ok) values ('Laufender Monat', false);
  exception when others then insert into r (test, ok, info) values ('Laufender Monat nicht abschließbar', true, sqlerrm); end;
  c := public.close_month(m);
  insert into r (test, ok, info) values ('Monatsabschluss mit SHA-256', length(c.hash) = 64, m || ' ' || left(c.hash, 12));
end $$;
reset role;
do $$ begin insert into public.transactions (no, date, time, month, lines, payments, totals) values (nextval('bon_no_seq'), (date_trunc('month', now()) - interval '3 days')::date, 1, to_char(now() - interval '1 month', 'YYYY-MM'), '[]', '[]', '{}');
  insert into r (test, ok) values ('Monatssperre', false);
exception when others then insert into r (test, ok, info) values ('Monatssperre greift auch für DB-Eigentümer', true, sqlerrm); end $$;
do $$ begin delete from public.audit_log; insert into r (test, ok) values ('Audit löschen', false);
exception when others then insert into r (test, ok, info) values ('Audit-Log nur anhängbar (auch Eigentümer)', true, sqlerrm); end $$;
do $$ begin update public.transactions set note = 'x'; insert into r (test, ok) values ('Bon ändern Eigentümer', false);
exception when others then insert into r (test, ok, info) values ('Bons nur anhängbar (auch Eigentümer)', true, sqlerrm); end $$;
insert into r (test, ok, info) select 'Audit-Log protokolliert', count(*) >= 5, count(*) || ' Einträge' from public.audit_log;
insert into r (test, ok, info) select 'Jede Tabelle hat RLS', bool_and(c.relrowsecurity), string_agg(c.relname, ',') filter (where not c.relrowsecurity)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';
select n, case when ok then 'OK  ' else 'FAIL' end as st, test, left(coalesce(info, ''), 110) as info from r order by n;
select count(*) filter (where ok) || '/' || count(*) as ergebnis from r;

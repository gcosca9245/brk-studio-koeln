#!/bin/sh
# Spielt supabase/schema.sql in eine frische lokale Datenbank (Auth-Stub) und führt die Rechte-/Buchungstests aus.
P="psql -h /tmp -p 5499 -U postgres -q"
psql -h /tmp -p 5499 -U postgres -qc "drop database if exists brk" -c "create database brk" >/dev/null
$P -d brk -v ON_ERROR_STOP=1 -f /workspace/brk-studio/site/tools/supabase-auth-stub.sql && $P -d brk -v ON_ERROR_STOP=1 -f /workspace/brk-studio/site/supabase/schema.sql && $P -d brk -f /workspace/brk-studio/tools/test-schema.sql

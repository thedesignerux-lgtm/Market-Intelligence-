#!/usr/bin/env bash
# Prueba completa contra un PostgreSQL local con PostGIS:
#   1. base de datos limpia + migraciones
#   2. importación REAL (RED + OSM) de Santiago de Compostela, dos veces (idempotencia)
#   3. pruebas de seguridad (RLS) y funciones SQL
#   4. pruebas de integración de la ingesta
# Variables: PGHOST, PGPORT, PGUSER (conexión local) y CONTACT (contacto para el User-Agent).
set -euo pipefail
cd "$(dirname "$0")/.."

DB=${TEST_DB:-mi_e2e}
MUNI=${TEST_MUNICIPALITY:-15078}
: "${CONTACT:?Define CONTACT (email o URL de contacto del proyecto)}"
export DATABASE_URL="postgresql://${PGUSER:-postgres}@/${DB}?host=${PGHOST:-/tmp}&port=${PGPORT:-5432}"
export TEST_DATABASE_URL="$DATABASE_URL"
psql_db() { psql -X -q -v ON_ERROR_STOP=1 -d "$DB" "$@"; }

echo "▶ 1. Base de datos limpia y migraciones"
dropdb --if-exists "$DB" && createdb "$DB"
psql_db -f tests/sql/00_supabase_shim.sql
for f in supabase/migrations/*.sql; do psql_db -f "$f"; done

echo "▶ 2. Importación real (RED + OSM) de $MUNI"
npm run -s import -- red_galicia "$MUNI" | grep '\[worker\]'
npm run -s import -- osm "$MUNI" | grep '\[worker\]'
first=$(psql_db -At -c "select count(*) from public.entities")
echo "   Entidades tras la primera importación: $first"

echo "▶ 2b. Reimportación (no debe crear duplicados)"
npm run -s import -- red_galicia "$MUNI" | grep '\[worker\]'
npm run -s import -- osm "$MUNI" | grep '\[worker\]'
second=$(psql_db -At -c "select count(*) from public.entities")
created=$(psql_db -At -c "select coalesce(sum((stats->>'created')::int),0) from public.import_runs where created_at > now() - interval '1 hour' and id in (select id from public.import_runs order by created_at desc limit 2)")
if [[ "$first" != "$second" || "$created" != "0" ]]; then
  echo "✖ La reimportación cambió el número de entidades ($first → $second, creadas $created)"; exit 1
fi
echo "   ✔ Idempotente: $second entidades, 0 creadas en la segunda pasada"

echo "▶ 3. Pruebas SQL (seguridad y funciones)"
for t in tests/sql/1*.sql tests/sql/2*.sql; do
  psql -X -d "$DB" -f "$t" | grep -E "^ (OK|FALLO)" || true
  psql -X -d "$DB" -f "$t" > /dev/null
done

echo "▶ 4. Pruebas unitarias y de integración"
npx vitest run

echo "✔ Todo correcto"

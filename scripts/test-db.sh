#!/usr/bin/env bash
# Runs the database tests against a fresh Postgres.
# With DATABASE_URL set, that database is reset and used. Otherwise a throwaway local cluster is started.
set -euo pipefail
cd "$(dirname "$0")/.."

apply_sql() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$1" >/dev/null
}

reset_and_migrate() {
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -c "drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;" >/dev/null
  apply_sql supabase/tests/shim.sql
  for f in $(ls supabase/migrations/*.sql 2>/dev/null | sort); do
    apply_sql "$f"
  done
}

if [ -n "${DATABASE_URL:-}" ]; then
  reset_and_migrate
  exec npx vitest run --project db --no-file-parallelism "$@"
fi

PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
if [ -z "$PGBIN" ]; then echo "No local Postgres server found and DATABASE_URL is not set." >&2; exit 1; fi

DATA="$(mktemp -d /tmp/seshup-pg-XXXXXX)"
PORT="${PGPORT_TEST:-54329}"
RUN_AS=""
if [ "$(id -u)" = "0" ]; then
  chown postgres:postgres "$DATA"
  RUN_AS="runuser -u postgres --"
fi
cleanup() {
  $RUN_AS "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

$RUN_AS "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
$RUN_AS "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1 -c max_connections=60" -w start >/dev/null
export DATABASE_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
reset_and_migrate
npx vitest run --project db --no-file-parallelism "$@"

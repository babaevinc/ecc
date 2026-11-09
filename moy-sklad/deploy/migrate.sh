#!/usr/bin/env bash
# «Мой склад»: brings the self-hosted Supabase on this server up to a release.
#   1. applies new SQL migrations in name order, each in one transaction (a failing file changes nothing);
#   2. installs the Edge Function «notify» and restarts the functions service;
#   3. stores the Vault secrets and the every-minute push job that backend/README.md describes.
#
# Usage (on the server, as root):  bash migrate.sh /opt/moy-sklad/releases/<commit>
# The release directory holds backend/supabase/{migrations,functions} from the repository.
#
# Applied versions are recorded in supabase_migrations.schema_migrations, the table the Supabase CLI
# uses, so `supabase migration list --db-url ...` shows the same history.
#
# Test hooks (local tests only): MS_PSQL replaces the psql command, MS_SKIP_SERVER=1 skips steps 2–3.
set -euo pipefail

RELEASE=${1:?usage: migrate.sh <release-dir>}
PROJECT=${MS_SUPABASE_DIR:-/opt/moy-sklad/supabase}
MIGRATIONS="$RELEASE/backend/supabase/migrations"
FUNCTIONS="$RELEASE/backend/supabase/functions"

log() { printf '[migrate] %s\n' "$*"; }
die() { printf '[migrate] ERROR: %s\n' "$*" >&2; exit 1; }

[ -d "$MIGRATIONS" ] || die "no migrations in $MIGRATIONS"

run_psql() {
  if [ -n "${MS_PSQL:-}" ]; then
    # shellcheck disable=SC2086 # MS_PSQL is a command line on purpose
    $MS_PSQL -X -q -A -t -v ON_ERROR_STOP=1 "$@"
  else
    (cd "$PROJECT" && docker compose exec -T db psql -U postgres -d postgres -X -q -A -t -v ON_ERROR_STOP=1 "$@")
  fi
}

run_psql <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
SQL

applied=0
for file in $(find "$MIGRATIONS" -maxdepth 1 -name '*.sql' -printf '%f\n' | sort); do
  version=${file%%_*}
  name=${file#*_}; name=${name%.sql}
  [[ $version =~ ^[0-9]{14}$ ]] || die "unexpected migration file name: $file"
  done_before=$(run_psql -c "select count(*) from supabase_migrations.schema_migrations where version = '$version'")
  if [ "$done_before" = "1" ]; then continue; fi
  log "applying $file"
  { cat "$MIGRATIONS/$file"
    printf '\ninsert into supabase_migrations.schema_migrations (version, name) values (%s, %s);\n' "'$version'" "'${name//\'/}'"
  } | run_psql --single-transaction -f - || die "$file failed; nothing from it was applied"
  applied=$((applied + 1))
done
log "migrations applied: $applied"

if [ "${MS_SKIP_SERVER:-0}" = "1" ]; then exit 0; fi

[ -f "$PROJECT/.env" ] || die "Supabase is not installed in $PROJECT (run install.sh first)"
env_value() { grep "^$1=" "$PROJECT/.env" | head -n1 | cut -d= -f2-; }

# Edge Function: the official «main» router serves /functions/v1/<folder name>.
[ -d "$FUNCTIONS/notify" ] || die "no notify function in $FUNCTIONS"
rm -rf "$PROJECT/volumes/functions/hello" "$PROJECT/volumes/functions/notify" "$PROJECT/volumes/functions/_shared"
cp -r "$FUNCTIONS/notify" "$FUNCTIONS/_shared" "$PROJECT/volumes/functions/"
(cd "$PROJECT" && docker compose restart functions >/dev/null)
log "Edge Function notify installed"

# pg_net calls the API gateway inside the Docker network, so the job does not depend on DNS or TLS.
service_key=$(env_value SERVICE_ROLE_KEY)
[[ $service_key =~ ^[A-Za-z0-9._-]+$ ]] || die "SERVICE_ROLE_KEY in .env looks wrong"
run_psql <<SQL
create extension if not exists pg_net;
create extension if not exists pg_cron;
select set_config('ms.project_url', 'http://api-gw:8000', false), set_config('ms.service_key', '$service_key', false);
do \$\$
declare
  v_name text;
  v_value text;
begin
  foreach v_name in array array['project_url', 'service_role_key'] loop
    v_value := current_setting(case v_name when 'project_url' then 'ms.project_url' else 'ms.service_key' end);
    if exists (select 1 from vault.secrets where name = v_name) then
      perform vault.update_secret((select id from vault.secrets where name = v_name), v_value);
    else
      perform vault.create_secret(v_value, v_name);
    end if;
  end loop;
end
\$\$;
select cron.schedule('moy-sklad-notify', '* * * * *', \$job\$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
    body := '{}'::jsonb)
\$job\$);
SQL
log "push job scheduled (every minute)"

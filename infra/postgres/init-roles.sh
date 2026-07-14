#!/bin/sh
set -eu
umask 077

secret_dir="${POSTGRES_SECRET_DIR:-/run/secrets}"
sql_file=''

cleanup() {
  if [ -n "$sql_file" ]; then
    rm -f "$sql_file"
  fi
  unset migrator_password app_password backup_password
}
trap cleanup 0
trap 'exit 1' HUP INT TERM

case "${POSTGRES_USER:-}" in
  portfolio_migrator | portfolio_app | portfolio_backup)
    printf '%s\n' \
      'POSTGRES_USER must name a dedicated bootstrap administrator' >&2
    exit 1
    ;;
esac

if (: </dev/tty) 2>/dev/null; then
  printf '%s\n' \
    'PostgreSQL role bootstrap requires a non-interactive session' >&2
  exit 1
fi

migrator_password="$(tr -d '\n' <"$secret_dir/postgres-migrator-password")"
app_password="$(tr -d '\n' <"$secret_dir/postgres-app-password")"
backup_password="$(tr -d '\n' <"$secret_dir/postgres-backup-password")"
if [ -z "$migrator_password" ] || [ -z "$app_password" ] || \
  [ -z "$backup_password" ]; then
  printf '%s\n' 'PostgreSQL role secrets must not be empty' >&2
  exit 1
fi

sql_file="$(mktemp "${TMPDIR:-/tmp}/portfolio-init.XXXXXX")"
chmod 600 "$sql_file"
cat >"$sql_file" <<'SQL'
\set ON_ERROR_STOP on
begin;
set password_encryption = 'scram-sha-256';
create role portfolio_migrator login nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
\password portfolio_migrator
create role portfolio_app login;
\password portfolio_app
create role portfolio_backup login;
\password portfolio_backup
alter database :"db_name" owner to portfolio_migrator;
revoke connect, temporary on database :"db_name" from public;
grant connect on database :"db_name" to portfolio_migrator, portfolio_app, portfolio_backup;
commit;
SQL

printf '%s\n%s\n%s\n%s\n%s\n%s\n' \
  "$migrator_password" "$migrator_password" \
  "$app_password" "$app_password" \
  "$backup_password" "$backup_password" |
  psql --no-psqlrc --set=ON_ERROR_STOP=1 \
    --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=db_name="$POSTGRES_DB" --file="$sql_file"

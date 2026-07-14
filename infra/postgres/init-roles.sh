#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

app_password="$(tr -d '\n' </run/secrets/postgres-app-password)"
backup_password="$(tr -d '\n' </run/secrets/postgres-backup-password)"

psql --set=ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$app_password" --set=backup_password="$backup_password" \
  --set=db_name="$POSTGRES_DB" <<'SQL'
set password_encryption = 'scram-sha-256';
create role portfolio_app login password :'app_password';
create role portfolio_backup login password :'backup_password';
grant connect on database :"db_name" to portfolio_app, portfolio_backup;
SQL
unset app_password backup_password

#!/bin/bash -p
set +x
export -n BASH_ENV BASHOPTS BASH_XTRACEFD ENV PS4 SHELLOPTS
set -Eeuo pipefail
umask 077
export LC_ALL=C
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
for variable in "${!DOCKER_@}"; do
  unset "$variable"
done
unset variable
unset BASH_ENV CDPATH ENV GLOBIGNORE PS4
# Xtrace is disabled before environment access. Do not unset BASH_XTRACEFD:
# Bash closes the referenced descriptor, which may be the inherited lock FD.
export HOME=/etc/mlp
export DOCKER_CONFIG=/etc/mlp/docker-client
export DOCKER_HOST=unix:///run/docker.sock

# shellcheck source=/dev/null
source /opt/mlp/ops/lib/operations.sh

readonly MLP_RESTORE_BACKUP_REPORT=/var/lib/mlp/backup-reports/latest-success.json
readonly MLP_RESTORE_WORK_PARENT=/var/lib/mlp/restore-work
readonly MLP_RESTORE_REPORT_DIRECTORY=/var/lib/mlp/restore-reports
readonly MLP_RESTORE_SUCCESS_REPORT=/var/lib/mlp/restore-reports/latest-success.json
readonly MLP_RESTORE_IMAGE='postgres:18.4-alpine@sha256:9a8afca54e7861fd90fab5fdf4c42477a6b1cb7d293595148e674e0a3181de15'
readonly MLP_RESTORE_OPERATION_LABEL='com.mlp.operation=restore-test'
readonly MLP_RESTORE_CLEANUP_POLLS=35
readonly MLP_RESTORE_ABSENCE_CONFIRMATIONS=3
readonly MLP_RESTORE_FAST_OBSERVATIONS=3
readonly MLP_RESTORE_SETTLE_OBSERVATIONS=30

MLP_RESTORE_STARTED_AT=
MLP_RESTORE_RUN_ID=
MLP_RESTORE_WORK=
MLP_RESTORE_HELPER=
MLP_RESTORE_CONTAINER=
MLP_RESTORE_NETWORK=
MLP_RESTORE_VOLUME=
MLP_RESTORE_DUMP_COPY=
MLP_RESTORE_PASSWORD_FILE=
MLP_RESTORE_HELPER_TRACKED=false
MLP_RESTORE_CONTAINER_CREATED=false
MLP_RESTORE_NETWORK_CREATED=false
MLP_RESTORE_VOLUME_CREATED=false
MLP_RESTORE_RETAIN_EVIDENCE=false
MLP_RESTORE_HELPER_CLEANUP_MINIMUM=$MLP_RESTORE_SETTLE_OBSERVATIONS
MLP_RESTORE_CONTAINER_CLEANUP_MINIMUM=$MLP_RESTORE_SETTLE_OBSERVATIONS
MLP_RESTORE_NETWORK_CLEANUP_MINIMUM=$MLP_RESTORE_SETTLE_OBSERVATIONS
MLP_RESTORE_VOLUME_CLEANUP_MINIMUM=$MLP_RESTORE_SETTLE_OBSERVATIONS

mlp_restore_now() {
  /usr/bin/date -u +%Y-%m-%dT%H:%M:%SZ
}

mlp_restore_read_snapshot_id() {
  /usr/bin/jq -er '
    if type == "object"
      and ((keys | sort) == ["completedAt", "snapshotId", "startedAt", "status"])
      and .status == "passed"
      and (.startedAt | type == "string"
        and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
      and (.completedAt | type == "string"
        and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
      and (.snapshotId | type == "string" and test("^[0-9a-f]{64}$"))
    then .snapshotId
    else error("backup report rejected")
    end
  ' "$MLP_RESTORE_BACKUP_REPORT"
}

mlp_restore_random_id() {
  local uuid

  IFS= read -r uuid </proc/sys/kernel/random/uuid || return $?
  uuid=${uuid//-/}
  [[ $uuid =~ ^[0-9a-f]{32}$ ]] || return 1
  printf '%s\n' "$uuid"
}

mlp_restore_make_workdir() {
  local directory=$1

  [[ $directory == "$MLP_RESTORE_WORK_PARENT/$MLP_RESTORE_RUN_ID" ]] || return 1
  [[ ! -e $directory && ! -L $directory ]] || return 1
  /usr/bin/install -d -o 10001 -g 10001 -m 0700 -- "$directory"
  [[ ! -L $directory ]] || return 1
  [[ $(/usr/bin/stat -c '%u:%g:%a' -- "$directory") == 10001:10001:700 ]]
}

mlp_restore_restic_snapshot() {
  local snapshot_id=$1
  local work=$2

  [[ $snapshot_id =~ ^[0-9a-f]{64}$ ]] || return 1
  [[ $work == "$MLP_RESTORE_WORK_PARENT/$MLP_RESTORE_RUN_ID" ]] || return 1
  [[ $MLP_RESTORE_HELPER == "mlp-restore-$MLP_RESTORE_RUN_ID-restic" ]] ||
    return 1
  /usr/bin/timeout --signal=TERM --kill-after=30s 30m \
    /usr/local/sbin/mlp-compose --profile jobs run --rm --no-TTY --no-deps \
    --name "$MLP_RESTORE_HELPER" \
    --label "$MLP_RESTORE_OPERATION_LABEL" \
    --label "com.mlp.run-id=$MLP_RESTORE_RUN_ID" \
    --volume "$work:/restore" \
    --entrypoint /usr/local/bin/mlp-restic db-backup \
    restore "$snapshot_id" --target /restore >/dev/null 2>&1
}

mlp_restore_find_dump() {
  local work=$1
  local unsafe_path
  local -a dumps=()

  unsafe_path="$(
    /usr/bin/find "$work" -xdev \
      \( -type l -o -type b -o -type c -o -type p -o -type s \) \
      -print -quit
  )"
  [[ -z $unsafe_path ]] || return 1
  while IFS= read -r -d '' dump; do
    dumps+=("$dump")
  done < <(
    /usr/bin/find "$work" -xdev -type f -name postgresql.dump -print0
  )
  ((${#dumps[@]} == 1)) || return 1
  [[ $(/usr/bin/stat -c '%u:%g:%a' -- "${dumps[0]}") == 10001:10001:600 ]] ||
    return 1
  printf '%s\n' "${dumps[0]}"
}

mlp_restore_prepare_postgres_files() {
  local dump=$1
  local input_directory secret

  input_directory="$MLP_RESTORE_WORK/postgres-input"
  /usr/bin/install -d -o 70 -g 70 -m 0700 -- "$input_directory"
  MLP_RESTORE_DUMP_COPY="$input_directory/postgresql.dump"
  MLP_RESTORE_PASSWORD_FILE="$input_directory/postgres-bootstrap-password"
  /usr/bin/install -o 70 -g 70 -m 0400 -- \
    "$dump" "$MLP_RESTORE_DUMP_COPY"
  secret="$(mlp_restore_random_id)$(mlp_restore_random_id)"
  [[ $secret =~ ^[0-9a-f]{64}$ ]] || return 1
  printf '%s\n' "$secret" >"$MLP_RESTORE_PASSWORD_FILE"
  unset secret
  /usr/bin/chown 70:70 -- "$MLP_RESTORE_PASSWORD_FILE"
  /usr/bin/chmod 0400 -- "$MLP_RESTORE_PASSWORD_FILE"
}

mlp_restore_create_network() {
  /usr/bin/timeout --signal=TERM --kill-after=5s 30s \
    /usr/bin/docker network create --internal \
    --label "$MLP_RESTORE_OPERATION_LABEL" \
    --label "com.mlp.run-id=$MLP_RESTORE_RUN_ID" \
    "$MLP_RESTORE_NETWORK" >/dev/null
}

mlp_restore_create_volume() {
  /usr/bin/timeout --signal=TERM --kill-after=5s 30s \
    /usr/bin/docker volume create \
    --label "$MLP_RESTORE_OPERATION_LABEL" \
    --label "com.mlp.run-id=$MLP_RESTORE_RUN_ID" \
    "$MLP_RESTORE_VOLUME" >/dev/null
}

mlp_restore_create_container() {
  /usr/bin/timeout --signal=TERM --kill-after=10s 1m \
    /usr/bin/docker run --detach --pull never \
    --name "$MLP_RESTORE_CONTAINER" \
    --label "$MLP_RESTORE_OPERATION_LABEL" \
    --label "com.mlp.run-id=$MLP_RESTORE_RUN_ID" \
    --network "$MLP_RESTORE_NETWORK" \
    --user 70:70 \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges:true \
    --tmpfs /tmp:rw,noexec,nosuid,nodev,uid=70,gid=70,mode=1770 \
    --tmpfs /var/run/postgresql:rw,noexec,nosuid,nodev,uid=70,gid=70,mode=0770 \
    --mount "type=volume,src=$MLP_RESTORE_VOLUME,dst=/var/lib/postgresql" \
    --mount "type=bind,src=$MLP_RESTORE_DUMP_COPY,dst=/restore/postgresql.dump,readonly" \
    --mount "type=bind,src=$MLP_RESTORE_PASSWORD_FILE,dst=/run/secrets/postgres-bootstrap-password,readonly" \
    --env POSTGRES_USER=postgres \
    --env POSTGRES_DB=postgres \
    --env POSTGRES_PASSWORD_FILE=/run/secrets/postgres-bootstrap-password \
    --env POSTGRES_INITDB_ARGS=--auth-host=scram-sha-256 \
    --log-driver none \
    --stop-timeout 30 \
    "$MLP_RESTORE_IMAGE" >/dev/null
}

mlp_restore_wait_postgres() {
  local attempt

  for ((attempt = 1; attempt <= 60; attempt += 1)); do
    if /usr/bin/timeout --signal=TERM --kill-after=2s 10s \
      /usr/bin/docker exec "$MLP_RESTORE_CONTAINER" \
      pg_isready --username postgres --dbname postgres >/dev/null 2>&1; then
      return 0
    fi
    if ((attempt < 60)); then
      /usr/bin/sleep 2
    fi
  done
  printf '%s\n' 'restore database unavailable' >&2
  return 1
}

mlp_restore_bootstrap_roles() {
  /usr/bin/timeout --signal=TERM --kill-after=10s 2m \
    /usr/bin/docker exec --interactive "$MLP_RESTORE_CONTAINER" \
    psql --no-psqlrc --set=ON_ERROR_STOP=1 --quiet \
    --username postgres --dbname postgres <<'SQL'
create role portfolio_migrator login password null
  nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role portfolio_app login password null
  nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role portfolio_backup login password null
  nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create database portfolio_restore owner portfolio_migrator;
revoke connect, temporary on database portfolio_restore from public;
grant connect on database portfolio_restore to
  portfolio_migrator, portfolio_app, portfolio_backup;
SQL
}

mlp_restore_load_dump() {
  /usr/bin/timeout --signal=TERM --kill-after=10s 2m \
    /usr/bin/docker exec "$MLP_RESTORE_CONTAINER" \
    pg_restore --list /restore/postgresql.dump >/dev/null 2>&1 || return $?
  /usr/bin/timeout --signal=TERM --kill-after=30s 30m \
    /usr/bin/docker exec "$MLP_RESTORE_CONTAINER" \
    pg_restore --exit-on-error --username postgres \
    --dbname portfolio_restore /restore/postgresql.dump >/dev/null 2>&1
}

mlp_restore_validate_representative_queries() {
  [[ $MLP_RESTORE_RUN_ID =~ ^[0-9a-f]{32}$ ]] || return 1
  /usr/bin/timeout --signal=TERM --kill-after=10s 5m \
    /usr/bin/docker exec --interactive "$MLP_RESTORE_CONTAINER" \
    psql --no-psqlrc --set=ON_ERROR_STOP=1 --quiet \
    --set="probe_id=mlp-restore-$MLP_RESTORE_RUN_ID" \
    --username postgres --dbname portfolio_restore >/dev/null <<'SQL'
begin;
set local role portfolio_app;
select id, source_order, key, title
from profile_sections order by source_order, id limit 1;
select id, source_order, title
from current_occupations order by source_order, id limit 1;
select id, source_order, title, project_details
from projects order by source_order, id limit 1;
select name from kysely_migration order by timestamp desc limit 1;
insert into contact_messages (
  id, full_name, email, subject, message, created_at
) values (
  :'probe_id', 'Restore validation', 'restore-validation@example.invalid',
  'Restore validation', 'Rolled back restore validation', current_timestamp
);
rollback;

begin;
set local role portfolio_backup;
select
  (select count(*) from profile_sections),
  (select count(*) from current_occupations),
  (select count(*) from hobbies),
  (select count(*) from languages),
  (select count(*) from page_cards),
  (select count(*) from professional_timeline),
  (select count(*) from projects),
  (select count(*) from pursuits),
  (select count(*) from social_links),
  (select count(*) from contact_messages),
  (select count(*) from kysely_migration),
  (select count(*) from kysely_migration_lock);
rollback;
SQL
}

mlp_restore_validate_database() {
  /usr/bin/timeout --signal=TERM --kill-after=10s 5m \
    /usr/bin/docker exec --interactive "$MLP_RESTORE_CONTAINER" \
    psql --no-psqlrc --set=ON_ERROR_STOP=1 --quiet --tuples-only \
    --no-align --username postgres --dbname portfolio_restore <<'SQL'
do $validation$
declare
  application_table_count integer;
  owned_table_count integer;
  populated_content_count integer;
  constrained_role_count integer;
  table_matrix_ok boolean;
  database_acl text[];
begin
  select count(*) into application_table_count
  from information_schema.tables
  where table_schema = 'public'
    and table_type = 'BASE TABLE'
    and table_name = any(array[
      'profile_sections','current_occupations','hobbies','languages',
      'page_cards','professional_timeline','projects','pursuits',
      'social_links','contact_messages'
    ]);
  if application_table_count <> 10 or (
    select count(*) from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
  ) <> 12 then
    raise exception 'restore validation failed';
  end if;

  select count(*) into owned_table_count
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind = 'r'
    and pg_get_userbyid(relation.relowner) = 'portfolio_migrator';
  if owned_table_count <> 12 then
    raise exception 'restore validation failed';
  end if;

  if (select name from kysely_migration order by timestamp desc limit 1)
      is distinct from '002_runtime_grants' then
    raise exception 'restore validation failed';
  end if;

  select count(*) into constrained_role_count
  from pg_roles role
  join pg_authid auth on auth.oid = role.oid
  where role.rolname = any(array[
      'portfolio_migrator','portfolio_app','portfolio_backup'
    ])
    and role.rolcanlogin
    and not role.rolsuper
    and not role.rolcreatedb
    and not role.rolcreaterole
    and not role.rolreplication
    and not role.rolbypassrls
    and auth.rolpassword is null;
  if constrained_role_count <> 3 then
    raise exception 'restore validation failed';
  end if;

  select array_agg(acl_entry order by acl_entry) into database_acl
  from (
    select concat_ws('|',
      case when acl.grantee = 0 then 'PUBLIC'
           else acl.grantee::regrole::text end,
      acl.privilege_type,
      acl.is_grantable::text,
      acl.grantor::regrole::text
    ) as acl_entry
    from pg_database database
    cross join lateral aclexplode(database.datacl) acl
    where database.datname = current_database()
  ) database_acl_entries;
  if database_acl is distinct from array[
    'portfolio_app|CONNECT|false|portfolio_migrator',
    'portfolio_backup|CONNECT|false|portfolio_migrator',
    'portfolio_migrator|CONNECT|false|portfolio_migrator',
    'portfolio_migrator|CREATE|false|portfolio_migrator',
    'portfolio_migrator|TEMPORARY|false|portfolio_migrator'
  ] then
    raise exception 'restore validation failed';
  end if;

  if not (
    has_database_privilege('portfolio_migrator', current_database(), 'connect')
    and has_database_privilege('portfolio_migrator', current_database(), 'create')
    and has_database_privilege('portfolio_migrator', current_database(), 'temporary')
    and has_database_privilege('portfolio_app', current_database(), 'connect')
    and not has_database_privilege(
      'portfolio_app', current_database(), 'connect with grant option'
    )
    and not has_database_privilege('portfolio_app', current_database(), 'create')
    and not has_database_privilege('portfolio_app', current_database(), 'temporary')
    and has_database_privilege('portfolio_backup', current_database(), 'connect')
    and not has_database_privilege(
      'portfolio_backup', current_database(), 'connect with grant option'
    )
    and not has_database_privilege('portfolio_backup', current_database(), 'create')
    and not has_database_privilege('portfolio_backup', current_database(), 'temporary')
    and not has_database_privilege(0::oid, current_database(), 'connect')
    and not has_database_privilege(0::oid, current_database(), 'temporary')
    and has_schema_privilege('portfolio_app', 'public', 'usage')
    and not has_schema_privilege(
      'portfolio_app', 'public', 'usage with grant option'
    )
    and not has_schema_privilege('portfolio_app', 'public', 'create')
    and has_schema_privilege('portfolio_backup', 'public', 'usage')
    and not has_schema_privilege(
      'portfolio_backup', 'public', 'usage with grant option'
    )
    and not has_schema_privilege('portfolio_backup', 'public', 'create')
  ) then
    raise exception 'restore validation failed';
  end if;

  with runtime_roles(role_name) as (
    values ('portfolio_app'), ('portfolio_backup')
  ), runtime_tables(table_name) as (
    values
      ('profile_sections'),('current_occupations'),('hobbies'),('languages'),
      ('page_cards'),('professional_timeline'),('projects'),('pursuits'),
      ('social_links'),('contact_messages'),('kysely_migration'),
      ('kysely_migration_lock')
  )
  select bool_and(
    has_table_privilege(
      role_name, format('%I.%I', 'public', table_name), 'select'
    ) = (
      role_name = 'portfolio_backup'
      or (role_name = 'portfolio_app' and table_name = any(array[
        'profile_sections','current_occupations','hobbies','languages',
        'page_cards','professional_timeline','projects','pursuits',
        'social_links','kysely_migration'
      ]))
    )
    and has_table_privilege(
      role_name, format('%I.%I', 'public', table_name), 'insert'
    ) = (role_name = 'portfolio_app' and table_name = 'contact_messages')
    and not has_table_privilege(
      role_name, format('%I.%I', 'public', table_name), 'update'
    )
    and not has_table_privilege(
      role_name, format('%I.%I', 'public', table_name), 'delete'
    )
    and not has_table_privilege(
      role_name, format('%I.%I', 'public', table_name), 'truncate'
    )
    and not has_table_privilege(
      role_name, format('%I.%I', 'public', table_name), 'references'
    )
    and not has_table_privilege(
      role_name, format('%I.%I', 'public', table_name), 'trigger'
    )
    and not has_table_privilege(
      role_name, format('%I.%I', 'public', table_name),
      'select with grant option'
    )
    and not has_table_privilege(
      role_name, format('%I.%I', 'public', table_name),
      'insert with grant option'
    )
    and not has_table_privilege(
      0::oid, format('%I.%I', 'public', table_name), 'select'
    )
    and not has_table_privilege(
      0::oid, format('%I.%I', 'public', table_name), 'insert'
    )
    and not has_table_privilege(
      0::oid, format('%I.%I', 'public', table_name), 'update'
    )
    and not has_table_privilege(
      0::oid, format('%I.%I', 'public', table_name), 'delete'
    )
    and not has_table_privilege(
      0::oid, format('%I.%I', 'public', table_name), 'truncate'
    )
    and not has_table_privilege(
      0::oid, format('%I.%I', 'public', table_name), 'references'
    )
    and not has_table_privilege(
      0::oid, format('%I.%I', 'public', table_name), 'trigger'
    )
  ) into table_matrix_ok
  from runtime_roles cross join runtime_tables;
  if table_matrix_ok is distinct from true then
    raise exception 'restore validation failed';
  end if;

  select count(*) into populated_content_count
  from (
    select exists(select 1 from profile_sections) as populated
    union all select exists(select 1 from current_occupations)
    union all select exists(select 1 from hobbies)
    union all select exists(select 1 from languages)
    union all select exists(select 1 from page_cards)
    union all select exists(select 1 from professional_timeline)
    union all select exists(select 1 from projects)
    union all select exists(select 1 from pursuits)
    union all select exists(select 1 from social_links)
  ) content where populated;
  if populated_content_count <> 9
    or not exists(
      select 1 from profile_sections
      where btrim(key) <> '' and btrim(name) <> '' and btrim(surname) <> ''
    )
    or not exists(
      select 1 from current_occupations where btrim(title) <> ''
    )
    or not exists(
      select 1 from projects where jsonb_typeof(project_details) = 'object'
    ) then
    raise exception 'restore validation failed';
  end if;
end
$validation$;

select concat_ws('|',
  10,
  12,
  9,
  '002_runtime_grants',
  (select count(*) from profile_sections)
    + (select count(*) from current_occupations)
    + (select count(*) from hobbies)
    + (select count(*) from languages)
    + (select count(*) from page_cards)
    + (select count(*) from professional_timeline)
    + (select count(*) from projects)
    + (select count(*) from pursuits)
    + (select count(*) from social_links),
  (select count(*) from contact_messages)
);
SQL
}

mlp_restore_label_matches() {
  local kind=$1
  local name=$2
  local labels template

  case $kind in
    container)
      template='{{ index .Config.Labels "com.mlp.operation" }}|{{ index .Config.Labels "com.mlp.run-id" }}'
      ;;
    network | volume)
      template='{{ index .Labels "com.mlp.operation" }}|{{ index .Labels "com.mlp.run-id" }}'
      ;;
    *) return 1 ;;
  esac
  labels="$(
    /usr/bin/timeout --signal=TERM --kill-after=2s 15s \
      /usr/bin/docker "$kind" inspect --format "$template" "$name" \
      2>/dev/null
  )" || return $?
  [[ $labels == "restore-test|$MLP_RESTORE_RUN_ID" ]]
}

mlp_restore_remove_resource() {
  local kind=$1
  local name=$2

  case $kind in
    container)
      /usr/bin/timeout --signal=TERM --kill-after=5s 45s \
        /usr/bin/docker container rm --force "$name" >/dev/null
      ;;
    network)
      /usr/bin/timeout --signal=TERM --kill-after=5s 30s \
        /usr/bin/docker network rm "$name" >/dev/null
      ;;
    volume)
      /usr/bin/timeout --signal=TERM --kill-after=5s 30s \
        /usr/bin/docker volume rm "$name" >/dev/null
      ;;
    *) return 1 ;;
  esac
}

mlp_restore_resource_absent() {
  local kind=$1
  local name=$2
  local output

  case $kind in
    container)
      output="$(
        /usr/bin/timeout --signal=TERM --kill-after=2s 15s \
          /usr/bin/docker container ls --all \
          --filter "name=^/${name}$" --format '{{.Names}}'
      )" || return $?
      ;;
    network)
      output="$(
        /usr/bin/timeout --signal=TERM --kill-after=2s 15s \
          /usr/bin/docker network ls \
          --filter "name=^${name}$" --format '{{.Name}}'
      )" || return $?
      ;;
    volume)
      output="$(
        /usr/bin/timeout --signal=TERM --kill-after=2s 15s \
          /usr/bin/docker volume ls \
          --filter "name=^${name}$" --format '{{.Name}}'
      )" || return $?
      ;;
    *) return 1 ;;
  esac
  [[ -z $output ]]
}

mlp_restore_cleanup_one() {
  local kind=$1
  local name=$2
  local minimum_observations=$3
  local attempt absence_confirmations=0

  ((minimum_observations >= MLP_RESTORE_FAST_OBSERVATIONS)) || return 1
  ((minimum_observations <= MLP_RESTORE_SETTLE_OBSERVATIONS)) || return 1
  for ((attempt = 1; attempt <= MLP_RESTORE_CLEANUP_POLLS; attempt += 1)); do
    if mlp_restore_label_matches "$kind" "$name"; then
      absence_confirmations=0
      if ! mlp_restore_remove_resource "$kind" "$name"; then
        mlp_restore_resource_absent "$kind" "$name" || return 1
      fi
    elif mlp_restore_resource_absent "$kind" "$name"; then
      absence_confirmations=$((absence_confirmations + 1))
      if ((
        attempt >= minimum_observations &&
        absence_confirmations >= MLP_RESTORE_ABSENCE_CONFIRMATIONS
      )); then
        return 0
      fi
    else
      return 1
    fi

    if ((attempt < MLP_RESTORE_CLEANUP_POLLS)); then
      mlp_restore_cleanup_pause
    fi
  done
  return 1
}

mlp_restore_cleanup_pause() {
  /usr/bin/sleep 2
}

mlp_restore_cleanup_resources() {
  local failed=0

  if [[ $MLP_RESTORE_HELPER_TRACKED == true ]]; then
    if mlp_restore_cleanup_one container "$MLP_RESTORE_HELPER" \
      "$MLP_RESTORE_HELPER_CLEANUP_MINIMUM"; then
      MLP_RESTORE_HELPER_TRACKED=false
    else
      failed=1
    fi
  fi
  if [[ $MLP_RESTORE_CONTAINER_CREATED == true ]]; then
    if mlp_restore_cleanup_one container "$MLP_RESTORE_CONTAINER" \
      "$MLP_RESTORE_CONTAINER_CLEANUP_MINIMUM"; then
      MLP_RESTORE_CONTAINER_CREATED=false
    else
      failed=1
    fi
  fi
  if [[ $MLP_RESTORE_NETWORK_CREATED == true ]]; then
    if mlp_restore_cleanup_one network "$MLP_RESTORE_NETWORK" \
      "$MLP_RESTORE_NETWORK_CLEANUP_MINIMUM"; then
      MLP_RESTORE_NETWORK_CREATED=false
    else
      failed=1
    fi
  fi
  if [[ $MLP_RESTORE_VOLUME_CREATED == true ]]; then
    if mlp_restore_cleanup_one volume "$MLP_RESTORE_VOLUME" \
      "$MLP_RESTORE_VOLUME_CLEANUP_MINIMUM"; then
      MLP_RESTORE_VOLUME_CREATED=false
    else
      failed=1
    fi
  fi
  return "$failed"
}

mlp_restore_secure_evidence() {
  [[ -n $MLP_RESTORE_WORK ]] || return 0
  [[ $MLP_RESTORE_WORK == "$MLP_RESTORE_WORK_PARENT/$MLP_RESTORE_RUN_ID" ]] ||
    return 1
  [[ -e $MLP_RESTORE_WORK || -L $MLP_RESTORE_WORK ]] || return 0
  [[ ! -L $MLP_RESTORE_WORK ]] || return 1

  /usr/bin/chown --recursive --no-dereference root:root -- "$MLP_RESTORE_WORK" ||
    return 1
  /usr/bin/find "$MLP_RESTORE_WORK" -xdev -type d \
    -exec /usr/bin/chmod 0700 -- {} + || return 1
  /usr/bin/find "$MLP_RESTORE_WORK" -xdev -type f \
    -exec /usr/bin/chmod 0600 -- {} + || return 1
}

mlp_restore_delete_workdir() {
  [[ -n $MLP_RESTORE_WORK ]] || return 0
  [[ $MLP_RESTORE_WORK == "$MLP_RESTORE_WORK_PARENT/$MLP_RESTORE_RUN_ID" ]] ||
    return 1
  [[ $MLP_RESTORE_HELPER_TRACKED == false ]] || return 1
  [[ $MLP_RESTORE_CONTAINER_CREATED == false ]] || return 1
  [[ $MLP_RESTORE_NETWORK_CREATED == false ]] || return 1
  [[ $MLP_RESTORE_VOLUME_CREATED == false ]] || return 1
  [[ ! -L $MLP_RESTORE_WORK ]] || return 1
  if [[ -e $MLP_RESTORE_WORK ]]; then
    /usr/bin/find "$MLP_RESTORE_WORK" -xdev -depth -delete || return 1
  fi
  [[ ! -e $MLP_RESTORE_WORK && ! -L $MLP_RESTORE_WORK ]]
}

mlp_restore_exit_trap() {
  local status=$?

  trap - EXIT
  if [[ -n $MLP_RESTORE_WORK ]]; then
    if [[ $MLP_RESTORE_RETAIN_EVIDENCE == true ]]; then
      mlp_restore_secure_evidence || true
      status=1
    elif ! mlp_restore_cleanup_resources; then
      mlp_restore_secure_evidence || true
      status=1
    elif ! mlp_restore_delete_workdir; then
      mlp_restore_secure_evidence || true
      status=1
    fi
  fi
  exit "$status"
}

mlp_restore_make_report_file() {
  /usr/bin/mktemp "$MLP_RESTORE_REPORT_DIRECTORY/.report.XXXXXX"
}

mlp_restore_install_report() {
  local snapshot_id=$1
  local started_at=$2
  local completed_at=$3
  local migration=$4
  local application_tables=$5
  local owned_tables=$6
  local populated_tables=$7
  local content_rows=$8
  local contact_messages=$9
  local report_file

  report_file="$(mlp_restore_make_report_file)" || return $?
  if ! /usr/bin/jq -n \
    --arg status passed \
    --arg snapshotId "$snapshot_id" \
    --arg startedAt "$started_at" \
    --arg completedAt "$completed_at" \
    --arg migration "$migration" \
    --argjson applicationTables "$application_tables" \
    --argjson ownedTables "$owned_tables" \
    --argjson populatedContentTables "$populated_tables" \
    --argjson contentRows "$content_rows" \
    --argjson contactMessages "$contact_messages" \
    '{status:$status,snapshotId:$snapshotId,startedAt:$startedAt,completedAt:$completedAt,migration:$migration,counts:{applicationTables:$applicationTables,ownedTables:$ownedTables,populatedContentTables:$populatedContentTables,contentRows:$contentRows,contactMessages:$contactMessages}}' \
    >"$report_file"; then
    /bin/rm -f -- "$report_file"
    return 1
  fi
  if ! mlp_atomic_install_json "$report_file" "$MLP_RESTORE_SUCCESS_REPORT"; then
    /bin/rm -f -- "$report_file"
    return 1
  fi
  /bin/rm -f -- "$report_file"
}

mlp_restore_main() {
  local snapshot_id dump validation completed_at extra failure_status
  local application_tables owned_tables populated_tables migration
  local content_rows contact_messages

  if (($# != 0)); then
    printf '%s\n' 'restore test accepts no arguments' >&2
    return 64
  fi

  mlp_require_root
  mlp_acquire_operations_lock
  mlp_require_root_directory "/etc/mlp/docker-client" 0700
  mlp_require_root_directory "/var/lib/mlp/restore-work" 0700
  mlp_require_root_directory "/var/lib/mlp/restore-reports" 0700
  mlp_require_root_file "/var/lib/mlp/backup-reports/latest-success.json" 0600

  MLP_RESTORE_STARTED_AT="$(mlp_restore_now)"
  snapshot_id="$(mlp_restore_read_snapshot_id)" || return $?
  [[ $snapshot_id =~ ^[0-9a-f]{64}$ ]] || return 1
  MLP_RESTORE_RUN_ID="$(mlp_restore_random_id)" || return $?
  [[ $MLP_RESTORE_RUN_ID =~ ^[0-9a-f]{32}$ ]] || return 1
  MLP_RESTORE_WORK="$MLP_RESTORE_WORK_PARENT/$MLP_RESTORE_RUN_ID"
  MLP_RESTORE_HELPER="mlp-restore-$MLP_RESTORE_RUN_ID-restic"
  MLP_RESTORE_CONTAINER="mlp-restore-$MLP_RESTORE_RUN_ID"
  MLP_RESTORE_NETWORK="mlp-restore-$MLP_RESTORE_RUN_ID"
  MLP_RESTORE_VOLUME="mlp-restore-$MLP_RESTORE_RUN_ID-data"
  trap mlp_restore_exit_trap EXIT

  mlp_restore_make_workdir "$MLP_RESTORE_WORK"
  MLP_RESTORE_HELPER_TRACKED=true
  MLP_RESTORE_HELPER_CLEANUP_MINIMUM=$MLP_RESTORE_SETTLE_OBSERVATIONS
  if mlp_restore_restic_snapshot \
    "$snapshot_id" "$MLP_RESTORE_WORK" >/dev/null 2>&1; then
    MLP_RESTORE_HELPER_CLEANUP_MINIMUM=$MLP_RESTORE_FAST_OBSERVATIONS
  else
    failure_status=$?
    printf '%s\n' 'restore snapshot retrieval failed' >&2
    return "$failure_status"
  fi
  dump="$(mlp_restore_find_dump "$MLP_RESTORE_WORK")" || return $?
  mlp_restore_prepare_postgres_files "$dump"

  MLP_RESTORE_NETWORK_CREATED=true
  MLP_RESTORE_NETWORK_CLEANUP_MINIMUM=$MLP_RESTORE_SETTLE_OBSERVATIONS
  mlp_restore_create_network
  MLP_RESTORE_NETWORK_CLEANUP_MINIMUM=$MLP_RESTORE_FAST_OBSERVATIONS
  MLP_RESTORE_VOLUME_CREATED=true
  MLP_RESTORE_VOLUME_CLEANUP_MINIMUM=$MLP_RESTORE_SETTLE_OBSERVATIONS
  mlp_restore_create_volume
  MLP_RESTORE_VOLUME_CLEANUP_MINIMUM=$MLP_RESTORE_FAST_OBSERVATIONS
  MLP_RESTORE_CONTAINER_CREATED=true
  MLP_RESTORE_CONTAINER_CLEANUP_MINIMUM=$MLP_RESTORE_SETTLE_OBSERVATIONS
  mlp_restore_create_container
  MLP_RESTORE_CONTAINER_CLEANUP_MINIMUM=$MLP_RESTORE_FAST_OBSERVATIONS
  mlp_restore_wait_postgres
  mlp_restore_bootstrap_roles
  if ! mlp_restore_load_dump; then
    printf '%s\n' 'restore dump load failed' >&2
    return 1
  fi
  mlp_restore_validate_representative_queries
  validation="$(mlp_restore_validate_database)" || return $?
  IFS='|' read -r application_tables owned_tables populated_tables migration \
    content_rows contact_messages extra <<<"$validation"
  [[ -z ${extra:-} ]] || return 1
  [[ $application_tables == 10 ]] || return 1
  [[ $owned_tables == 12 ]] || return 1
  [[ $populated_tables == 9 ]] || return 1
  [[ $migration == 002_runtime_grants ]] || return 1
  [[ $content_rows =~ ^[0-9]+$ ]] || return 1
  [[ $contact_messages =~ ^[0-9]+$ ]] || return 1

  if ! mlp_restore_cleanup_resources; then
    MLP_RESTORE_RETAIN_EVIDENCE=true
    mlp_restore_secure_evidence || true
    printf '%s\n' 'restore cleanup could not be confirmed' >&2
    return 1
  fi
  if ! mlp_restore_delete_workdir; then
    MLP_RESTORE_RETAIN_EVIDENCE=true
    mlp_restore_secure_evidence || true
    printf '%s\n' 'restore plaintext retained for investigation' >&2
    return 1
  fi
  MLP_RESTORE_WORK=

  completed_at="$(mlp_restore_now)"
  mlp_restore_install_report \
    "$snapshot_id" "$MLP_RESTORE_STARTED_AT" "$completed_at" "$migration" \
    "$application_tables" "$owned_tables" "$populated_tables" \
    "$content_rows" "$contact_messages"
  printf '%s\n' 'isolated restore passed'
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  mlp_restore_main "$@"
fi

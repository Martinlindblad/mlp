#!/bin/sh
set -eu
umask 077

child_pid=
work=

cleanup() {
  set +e
  status=$1
  trap - 0 HUP INT TERM
  unset PGPASSWORD
  if [ -n "$work" ]; then
    rm -rf "$work"
  fi
  exit "$status"
}

run_child() {
  "$@" &
  child_pid=$!
  set +e
  wait "$child_pid"
  status=$?
  child_pid=
  set -e
  return "$status"
}

forward_signal() {
  set +e
  signal=$1
  status=$2
  : "$signal"
  trap - HUP INT TERM
  if [ -n "$child_pid" ]; then
    kill -TERM "$child_pid" 2>/dev/null
    sleep 3
    kill -KILL "$child_pid" 2>/dev/null
    wait "$child_pid" 2>/dev/null
    child_pid=
  fi
  cleanup "$status"
}

trap 'cleanup $?' 0
trap 'forward_signal HUP 129' HUP
trap 'forward_signal INT 130' INT
trap 'forward_signal TERM 143' TERM

: "${PGHOST:?PGHOST is required}"
: "${PGPORT:?PGPORT is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGPASSWORD_FILE:?PGPASSWORD_FILE is required}"
[ -r "$PGPASSWORD_FILE" ] || exit 64
[ -s "$PGPASSWORD_FILE" ] || exit 64

PGPASSWORD="$(cat "$PGPASSWORD_FILE")"
[ -n "$PGPASSWORD" ] || exit 64
export PGPASSWORD

work=$(mktemp -d /tmp/mlp-backup.XXXXXX)
dump="$work/postgresql.dump"
backup_json="$work/restic-backup.json"
export RESTIC_CACHE_DIR="$work/restic-cache"
mkdir -p "$RESTIC_CACHE_DIR"

run_child pg_dump --format=custom --file="$dump"
unset PGPASSWORD
run_child pg_restore --list "$dump" > /dev/null
run_child /usr/local/bin/mlp-restic backup --json --host mlp-prod \
  --tag mlp-postgresql "$dump" >"$backup_json" 2>/dev/null
run_child /usr/local/bin/mlp-restic forget --host mlp-prod --tag mlp-postgresql \
  --group-by host,tags --keep-daily 30 --prune >/dev/null 2>&1
run_child /usr/local/bin/mlp-restic check --read-data-subset=5% \
  >/dev/null 2>&1
cat "$backup_json"

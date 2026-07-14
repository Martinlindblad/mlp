#!/bin/sh
set -eu
umask 077

child_pid=

# Invoked indirectly by the condition-0 trap.
# shellcheck disable=SC2329
cleanup() {
  set +e
  status=$1
  trap - 0 HUP INT TERM
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
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

# Invoked indirectly by the signal traps.
# shellcheck disable=SC2329
forward_signal() {
  set +e
  signal=$1
  status=$2
  : "$signal"
  trap - HUP INT TERM
  if [ -n "$child_pid" ]; then
    kill -TERM "$child_pid" 2>/dev/null
    sleep 1
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

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is required}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE is required}"
: "${RESTIC_S3_ACCESS_KEY_ID_FILE:?RESTIC_S3_ACCESS_KEY_ID_FILE is required}"
: "${RESTIC_S3_SECRET_ACCESS_KEY_FILE:?RESTIC_S3_SECRET_ACCESS_KEY_FILE is required}"

case "$RESTIC_REPOSITORY" in
  *'@'*|*'?'*|*'#'*) exit 64 ;;
esac

[ -r "$RESTIC_PASSWORD_FILE" ] || exit 64
[ -s "$RESTIC_PASSWORD_FILE" ] || exit 64
[ -r "$RESTIC_S3_ACCESS_KEY_ID_FILE" ] || exit 64
[ -s "$RESTIC_S3_ACCESS_KEY_ID_FILE" ] || exit 64
[ -r "$RESTIC_S3_SECRET_ACCESS_KEY_FILE" ] || exit 64
[ -s "$RESTIC_S3_SECRET_ACCESS_KEY_FILE" ] || exit 64

unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
AWS_ACCESS_KEY_ID="$(cat "$RESTIC_S3_ACCESS_KEY_ID_FILE")"
AWS_SECRET_ACCESS_KEY="$(cat "$RESTIC_S3_SECRET_ACCESS_KEY_FILE")"
export AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
[ -n "$AWS_ACCESS_KEY_ID" ] || exit 64
[ -n "$AWS_SECRET_ACCESS_KEY" ] || exit 64

if run_child /usr/local/bin/restic "$@"; then
  status=0
else
  status=$?
fi
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
exit "$status"

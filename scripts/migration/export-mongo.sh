#!/bin/sh
set -eu
umask 077

: "${MONGO_URI_FILE:?MONGO_URI_FILE is required}"
: "${MONGO_DATABASE:?MONGO_DATABASE is required}"
: "${ARCHIVE_RECIPIENT:?ARCHIVE_RECIPIENT is required}"
: "${ARTIFACT_DIR:?ARTIFACT_DIR is required}"

command -v mongodump >/dev/null 2>&1
command -v age >/dev/null 2>&1
version="$(mongodump --version 2>/dev/null | sed -n 's/^mongodump version: v\{0,1\}\([^ ]*\).*$/\1/p' | head -n 1)"
case "$version" in
  100.17.0) ;;
  *) exit 1 ;;
esac
unset version

if [ ! -f "$MONGO_URI_FILE" ] || [ -L "$MONGO_URI_FILE" ]; then
  exit 1
fi
secret_mode="$(stat -c '%a' "$MONGO_URI_FILE" 2>/dev/null || stat -f '%Lp' "$MONGO_URI_FILE")"
case "$secret_mode" in
  600 | 400) ;;
  *) exit 1 ;;
esac
unset secret_mode

if [ -e "$ARTIFACT_DIR" ] && { [ ! -d "$ARTIFACT_DIR" ] || [ -L "$ARTIFACT_DIR" ]; }; then
  exit 1
fi
mkdir -p -- "$ARTIFACT_DIR"
[ ! -L "$ARTIFACT_DIR" ]
chmod 0700 "$ARTIFACT_DIR"
artifact_root="$(cd -P -- "$ARTIFACT_DIR" && pwd)"
work="$(mktemp -d "$artifact_root/.mongo-export.XXXXXX")"
trap 'rm -rf -- "$work"' 0 HUP INT TERM

uri=
if IFS= read -r uri <"$MONGO_URI_FILE"; then
  :
else
  [ -n "$uri" ] || exit 1
fi
if (IFS= read -r first_line && IFS= read -r second_line) <"$MONGO_URI_FILE"; then
  exit 1
fi
CR="$(printf '\r')"
case "$uri" in
  '' | *"$CR"*) exit 1 ;;
esac
unset CR
escaped_uri="$(printf '%s' "$uri" | sed "s/'/''/g")"
config="$work/mongodump.yml"
printf "uri: '%s'\n" "$escaped_uri" >"$config"
chmod 0600 "$config"
unset uri escaped_uri

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$artifact_root/mongo-final-$timestamp.archive.gz.age"
encrypted_tmp="$work/mongo-final-$timestamp.archive.gz.age.tmp"
mongodump_status_file="$work/mongodump.status"
age_status_file="$work/age.status"

(
  set +e
  mongodump --quiet --config="$config" --db="$MONGO_DATABASE" --archive --gzip \
    2>"$work/mongodump.stderr"
  printf '%s\n' "$?" >"$mongodump_status_file"
) | (
  set +e
  age --recipient "$ARCHIVE_RECIPIENT" --output "$encrypted_tmp" \
    2>"$work/age.stderr"
  printf '%s\n' "$?" >"$age_status_file"
)
dump_status="$(cat "$mongodump_status_file" 2>/dev/null || printf '1\n')"
age_status="$(cat "$age_status_file" 2>/dev/null || printf '1\n')"
if [ "$dump_status" != 0 ] || [ "$age_status" != 0 ]; then
  exit 1
fi
unset dump_status age_status
[ -s "$encrypted_tmp" ]
chmod 0600 "$encrypted_tmp"
if [ -e "$archive" ]; then
  exit 1
fi
mv -n -- "$encrypted_tmp" "$archive"
if [ -e "$encrypted_tmp" ] || [ ! -s "$archive" ]; then
  exit 1
fi
chmod 0600 "$archive"
printf '%s\n' "$archive"

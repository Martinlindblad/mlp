#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

: "${MONGO_URI_FILE:?MONGO_URI_FILE is required}"
: "${MONGO_DATABASE:?MONGO_DATABASE is required}"
: "${ARCHIVE_RECIPIENT:?ARCHIVE_RECIPIENT is required}"
: "${ARTIFACT_DIR:?ARTIFACT_DIR is required}"

command -v mongodump >/dev/null 2>&1
command -v age >/dev/null 2>&1
version="$(mongodump --version 2>/dev/null | sed -nE 's/^mongodump version: v?([^[:space:]]+).*$/\1/p' | head -n 1)"
case "$version" in
  100.17.0) ;;
  *) exit 1 ;;
esac
unset version

[[ -f "$MONGO_URI_FILE" && ! -L "$MONGO_URI_FILE" ]]
secret_mode="$(stat -f '%Lp' "$MONGO_URI_FILE" 2>/dev/null || stat -c '%a' "$MONGO_URI_FILE")"
[[ "$secret_mode" == 600 || "$secret_mode" == 400 ]]
unset secret_mode

if [[ -e "$ARTIFACT_DIR" && (! -d "$ARTIFACT_DIR" || -L "$ARTIFACT_DIR") ]]; then
  exit 1
fi
mkdir -p -- "$ARTIFACT_DIR"
[[ ! -L "$ARTIFACT_DIR" ]]
chmod 0700 "$ARTIFACT_DIR"
artifact_root="$(cd -P -- "$ARTIFACT_DIR" && pwd)"
work="$(mktemp -d "$artifact_root/.mongo-export.XXXXXX")"
trap 'rm -rf -- "$work"' EXIT

uri="$(<"$MONGO_URI_FILE")"
[[ -n "$uri" && "$uri" != *$'\n'* && "$uri" != *$'\r'* ]]
escaped_uri="${uri//\'/\'\'}"
config="$work/mongodump.yml"
printf "uri: '%s'\n" "$escaped_uri" >"$config"
chmod 0600 "$config"
unset uri escaped_uri

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive="$artifact_root/mongo-final-$timestamp.archive.gz.age"
encrypted_tmp="$work/mongo-final-$timestamp.archive.gz.age.tmp"

mongodump --quiet --config="$config" --db="$MONGO_DATABASE" --archive --gzip \
  2>"$work/mongodump.stderr" \
  | age --recipient "$ARCHIVE_RECIPIENT" --output "$encrypted_tmp" \
    2>"$work/age.stderr"
[[ -s "$encrypted_tmp" ]]
chmod 0600 "$encrypted_tmp"
if [[ -e "$archive" ]]; then
  exit 1
fi
mv -n -- "$encrypted_tmp" "$archive"
if [[ -e "$encrypted_tmp" || ! -s "$archive" ]]; then
  exit 1
fi
chmod 0600 "$archive"
printf '%s\n' "$archive"

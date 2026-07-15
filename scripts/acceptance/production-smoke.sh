#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -gt 1 ]]; then
  exit 64
fi

origin="${1:-https://martin-lindblad.com}"
case "$origin" in
  https://martin-lindblad.com | https://migration.martin-lindblad.com) ;;
  *) exit 64 ;;
esac

for command in curl jq grep tr; do
  command -v "$command" >/dev/null 2>&1 || exit 69
done
unset command

for route in \
  / \
  /about \
  /experience \
  /showcases \
  /cases \
  /contact \
  /api/health/live \
  /api/health/ready; do
  code="$(
    curl -sS --connect-timeout 10 --max-time 30 \
      -o /dev/null -w '%{http_code}' "$origin$route"
  )"
  [[ "$code" == 200 ]] || {
    printf '%s returned %s\n' "$route" "$code" >&2
    exit 1
  }
done

for route in \
  about \
  introduction \
  currentOccupation \
  languages \
  list \
  pageCards \
  professionalTimeline \
  projectsAndCases \
  pursuit \
  socialmedia; do
  body="$(
    curl -fsS --connect-timeout 10 --max-time 30 "$origin/api/$route"
  )"
  jq -e 'type == "array"' <<<"$body" >/dev/null
done

redirect="$(
  curl -sS --connect-timeout 10 --max-time 30 -o /dev/null -D - \
    'https://www.martin-lindblad.com/path?q=1' | tr -d '\r'
)"
grep -Fx 'HTTP/2 308' <<<"$redirect" >/dev/null
grep -Fix 'location: https://martin-lindblad.com/path?q=1' \
  <<<"$redirect" >/dev/null

range_code="$(
  curl -sS --connect-timeout 10 --max-time 30 -o /dev/null \
    -w '%{http_code}' -H 'Range: bytes=0-1023' "$origin/assets/man.mp4"
)"
[[ "$range_code" == 206 ]] || {
  printf '%s returned %s\n' '/assets/man.mp4 range request' "$range_code" >&2
  exit 1
}

curl -fsS --connect-timeout 10 --max-time 30 "$origin/manifest.json" |
  jq -e '.icons | length > 0' >/dev/null

printf 'production smoke passed\n'

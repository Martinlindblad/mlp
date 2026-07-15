#!/bin/bash

export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077

mlp_fail() {
  local message=${1:-operation failed}
  local status=${2:-1}
  printf '%s\n' "$message" >&2
  exit "$status"
}

mlp_require_root() {
  [[ ${EUID:-$(/usr/bin/id -u)} -eq 0 ]] || {
    printf '%s\n' 'operation requires root' >&2
    exit 77
  }
}

mlp_acquire_operations_lock() {
  local lock=/run/lock/mlp-operations.lock
  local target=
  local metadata

  if [[ -e /proc/$$/fd/9 ]]; then
    target=$(/usr/bin/readlink --canonicalize-existing -- /proc/$$/fd/9 2>/dev/null || true)
    if [[ "$target" == "$lock" ]] && /usr/bin/flock --nonblock 9; then
      return 0
    fi
  fi

  if [[ ! -e "$lock" && ! -L "$lock" ]]; then
    (set -o noclobber && : >"$lock") 2>/dev/null || true
  fi
  [[ -f "$lock" && ! -L "$lock" ]] || mlp_fail 'invalid operations lock' 78
  metadata=$(/usr/bin/stat --format='%u:%g:%a' -- "$lock")
  [[ "$metadata" == 0:0:600 ]] || mlp_fail 'unsafe operations lock' 78

  exec 9<>"$lock"
  /usr/bin/flock --timeout 30 9 || mlp_fail 'another platform operation is running' 75
}

mlp_require_root_directory() {
  local path=${1:-}
  local mode=${2:-}
  local metadata

  [[ "$path" == /* && "$mode" =~ ^0[0-7]{3}$ ]] || \
    mlp_fail 'invalid protected directory contract' 78
  [[ -d "$path" && ! -L "$path" ]] || \
    mlp_fail 'invalid protected directory' 78
  metadata=$(/usr/bin/stat --format='%u:%g:%a' -- "$path")
  [[ "$metadata" == "0:0:${mode#0}" ]] || \
    mlp_fail 'unsafe protected directory ownership or mode' 78
}

mlp_require_root_file() {
  local path=${1:-}
  local mode=${2:-}
  local metadata

  [[ "$path" == /* && "$mode" =~ ^0[0-7]{3}$ ]] || \
    mlp_fail 'invalid protected file contract' 78
  [[ -f "$path" && ! -L "$path" && -s "$path" ]] || \
    mlp_fail 'invalid protected file' 78
  metadata=$(/usr/bin/stat --format='%u:%g:%a' -- "$path")
  [[ "$metadata" == "0:0:${mode#0}" ]] || \
    mlp_fail 'unsafe protected file ownership or mode' 78
}

mlp_atomic_install_json() {
  local source=${1:-}
  local destination=${2:-}
  local directory
  local basename

  [[ -f "$source" && ! -L "$source" && -s "$source" ]] || \
    mlp_fail 'invalid report source' 78
  [[ "$destination" == /* ]] || mlp_fail 'invalid report destination' 78
  /usr/bin/jq -e 'type == "object"' "$source" >/dev/null || \
    mlp_fail 'invalid report document' 78

  directory=$(/usr/bin/dirname -- "$destination")
  basename=$(/usr/bin/basename -- "$destination")
  mlp_require_root_directory "$directory" 0700
  if [[ -e "$destination" || -L "$destination" ]]; then
    mlp_require_root_file "$destination" 0600
  fi

  (
    local temporary
    temporary=$(/usr/bin/mktemp "${directory}/.${basename}.XXXXXX")
    trap '/bin/rm -f -- "$temporary"' EXIT HUP INT TERM
    /usr/bin/install --owner=root --group=root --mode=0600 -- "$source" "$temporary"
    /bin/mv --force --no-target-directory -- "$temporary" "$destination"
    trap - EXIT HUP INT TERM
  )
}

mlp_atomic_replace_env() {
  local environment_file=${1:-}
  local key=${2:-}
  local value=${3:-}
  local directory
  local basename

  mlp_require_root_file "$environment_file" 0600
  [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || mlp_fail 'invalid environment key' 64
  [[ -n "$value" && "$value" != *$'\n'* && "$value" != *$'\r'* ]] || \
    mlp_fail 'invalid environment value' 64
  [[ "$value" != *[[:space:]]* ]] || mlp_fail 'invalid environment value' 64

  directory=$(/usr/bin/dirname -- "$environment_file")
  basename=$(/usr/bin/basename -- "$environment_file")
  mlp_require_root_directory "$directory" 0700

  (
    local rendered
    local staged
    rendered=$(/usr/bin/mktemp "${directory}/.${basename}.rendered.XXXXXX")
    staged=$(/usr/bin/mktemp "${directory}/.${basename}.staged.XXXXXX")
    trap '/bin/rm -f -- "$rendered" "$staged"' EXIT HUP INT TERM
    /usr/bin/awk -F= -v key="$key" -v value="$value" '
      BEGIN { found = 0 }
      $1 == key { print key "=" value; found += 1; next }
      { print }
      END { if (found != 1) exit 42 }
    ' "$environment_file" >"$rendered" || mlp_fail 'environment update failed' 78
    /usr/bin/install --owner=root --group=root --mode=0600 -- "$rendered" "$staged"
    /bin/mv --force --no-target-directory -- "$staged" "$environment_file"
    trap - EXIT HUP INT TERM
    /bin/rm -f -- "$rendered"
  )
}

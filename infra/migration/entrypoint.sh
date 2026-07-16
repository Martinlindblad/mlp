#!/bin/sh
set -eu
umask 077

usage() {
  printf '%s\n' 'usage: mlp-migration {export|rehearsal|preload|contacts|journal-recover|remove-synthetic UUID}' >&2
  exit 64
}

case "${1-}" in
  export)
    [ "$#" -eq 1 ] || usage
    exec /app/scripts/migration/export-mongo.sh
    ;;
  rehearsal)
    [ "$#" -eq 1 ] || usage
    exec /usr/local/bin/node /app/scripts/migration/run-rehearsal.js
    ;;
  preload)
    [ "$#" -eq 1 ] || usage
    exec /usr/local/bin/node /app/scripts/migration/preload-content.js
    ;;
  contacts)
    [ "$#" -eq 1 ] || usage
    exec /usr/local/bin/node /app/scripts/migration/finalize-contacts.js
    ;;
  journal-recover)
    [ "$#" -eq 1 ] || usage
    unset MONGO_URI_FILE MONGO_DATABASE MONGODB_URI MONGO_URI
    exec /usr/local/bin/node /app/scripts/journal/recover.js
    ;;
  remove-synthetic)
    [ "$#" -eq 2 ] || usage
    unset MONGO_URI_FILE MONGO_DATABASE
    exec /usr/local/bin/node /app/scripts/migration/remove-synthetic-contact.js "$2"
    ;;
  *)
    usage
    ;;
esac

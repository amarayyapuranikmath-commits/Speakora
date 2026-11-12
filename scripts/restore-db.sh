#!/bin/sh
# Restores a dump into a database. DESTRUCTIVE: replaces the objects in the target. Stop the backend first.
# Usage: PGHOST=... PGUSER=... PGPASSWORD=... restore-db.sh <dumpfile> <target-database> --i-understand-this-overwrites-data
set -eu
[ "${3:-}" = "--i-understand-this-overwrites-data" ] || { echo "Refusing: pass --i-understand-this-overwrites-data as the 3rd argument"; exit 2; }
pg_restore --list "$1" > /dev/null
pg_restore --clean --if-exists --no-owner --no-privileges --exit-on-error --dbname="$2" "$1"
echo "restore ok into $2"
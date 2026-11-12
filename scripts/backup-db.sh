#!/bin/sh
# Daily PostgreSQL backup: custom-format dump (compressed), verified, with retention.
# Usage: PGHOST=... PGUSER=... PGDATABASE=... PGPASSWORD=... KEEP_DAYS=14 backup-db.sh /backups
set -eu
DIR="${1:-./backups}"; KEEP_DAYS="${KEEP_DAYS:-14}"
mkdir -p "$DIR"
FILE="$DIR/${PGDATABASE}-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --no-privileges --file="$FILE.partial"
# A dump that cannot be listed is not a backup: verify before keeping it.
pg_restore --list "$FILE.partial" > /dev/null
mv "$FILE.partial" "$FILE"
echo "backup ok: $FILE ($(wc -c < "$FILE") bytes)"
# retention
find "$DIR" -name "${PGDATABASE}-*.dump" -type f -mtime +"$KEEP_DAYS" -print -delete
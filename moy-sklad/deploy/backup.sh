#!/usr/bin/env bash
# «Мой склад»: daily backup of the self-hosted Supabase (run by the moy-sklad-backup systemd timer).
#   - full database dump (pg_dump custom format, as supabase_admin like the official utils);
#   - the Supabase .env: without its JWT secret and keys a restored database cannot be used;
#   - an integrity check: the whole dump is read back with pg_restore, so a truncated file fails today,
#     not on the day it is needed;
#   - keeps the last KEEP_DAYS days; optionally copies each backup off the server with rclone.
#
# Optional settings in /etc/moy-sklad/backup.env:
#   KEEP_DAYS=14
#   RCLONE_TARGET=yandex-crypt:moy-sklad   # an rclone remote, ideally a «crypt» remote over S3 storage in Russia
set -euo pipefail

PROJECT=${MS_SUPABASE_DIR:-/opt/moy-sklad/supabase}
DEST=${MS_BACKUP_DIR:-/var/backups/moy-sklad}
KEEP_DAYS=14
RCLONE_TARGET=""
# shellcheck disable=SC1091
[ -f /etc/moy-sklad/backup.env ] && . /etc/moy-sklad/backup.env

log() { printf '[backup] %s\n' "$*"; }
die() { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }

[ -f "$PROJECT/.env" ] || die "Supabase is not installed in $PROJECT"
umask 077
mkdir -p "$DEST"
stamp=$(date +%Y-%m-%d_%H%M)
work=$(mktemp -d "$DEST/.tmp.XXXXXX")
trap 'rm -rf "$work"' EXIT

cd "$PROJECT"
docker compose exec -T db pg_dump -U supabase_admin -d postgres -Fc > "$work/db.dump" || die "pg_dump failed"
[ -s "$work/db.dump" ] || die "empty dump"
docker compose exec -T db pg_restore -f /dev/null < "$work/db.dump" || die "the dump cannot be read back"
cp "$PROJECT/.env" "$work/supabase.env"

archive="$DEST/moy-sklad_$stamp.tar"
tar -C "$work" -cf "$archive.part" db.dump supabase.env
mv "$archive.part" "$archive"
log "saved $archive ($(du -h "$archive" | cut -f1))"

find "$DEST" -maxdepth 1 -name 'moy-sklad_*.tar' -mtime +"$KEEP_DAYS" -delete

if [ -n "$RCLONE_TARGET" ]; then
  rclone copy "$archive" "$RCLONE_TARGET" || die "off-site copy to $RCLONE_TARGET failed (the local copy is kept)"
  log "copied to $RCLONE_TARGET"
fi

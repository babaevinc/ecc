#!/usr/bin/env bash
# «Мой склад»: one-time setup of a rented Ubuntu server (22.04 or 24.04) with self-hosted Supabase.
#   sudo bash install.sh sklad.example.ru
#
# What it does:
#   1. security updates on, firewall (SSH, HTTP, HTTPS only), fail2ban against SSH password guessing;
#   2. the official Supabase setup.sh at a pinned release: Docker, fresh random secrets and keys;
#   3. HTTPS through the official Caddy override (free Let's Encrypt certificate for your domain);
#      the database stays reachable from this server only (docker-compose.moysklad.yml);
#   4. sign-up closed (the owner adds people), Edge Functions require a valid key;
#   5. daily backups at 03:30 server time (backup.sh).
# Re-running it is safe: finished steps are skipped and settings are re-applied.
set -euo pipefail

# Official self-hosted release, pinned by tag and commit so the server gets exactly what was reviewed.
SUPABASE_REF="self-hosted/v0.8.3"
SUPABASE_COMMIT="bc27d2661edd09a5d0b8d76ce33da6d4071a756e"

BASE=/opt/moy-sklad
PROJECT="$BASE/supabase"
HERE=$(cd "$(dirname "$0")" && pwd)
DOMAIN=${1:-}

log() { printf '\n[install] %s\n' "$*"; }
die() { printf '[install] ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "run as root: sudo bash install.sh <domain>"
[[ $DOMAIN =~ ^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$ ]] || die "usage: sudo bash install.sh sklad.example.ru (a domain whose A record points to this server)"
# shellcheck source=/dev/null
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || die "this script supports Ubuntu only"

log "1/5 System updates, firewall, fail2ban"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get upgrade -yq
apt-get install -yq unattended-upgrades fail2ban ufw curl git openssl jq ca-certificates
dpkg-reconfigure -f noninteractive unattended-upgrades
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable
systemctl enable --now fail2ban

log "2/5 Supabase ($SUPABASE_REF)"
mkdir -p "$BASE"
if [ ! -f "$PROJECT/.env" ]; then
  setup=$(mktemp)
  curl -fsSL "https://raw.githubusercontent.com/supabase/supabase/$SUPABASE_COMMIT/docker/setup.sh" -o "$setup"
  (cd "$BASE" && sh "$setup" -y --ref "$SUPABASE_REF" --project-dir supabase)
  rm -f "$setup"
else
  echo "already installed in $PROJECT"
fi
cd "$PROJECT"

set_env() {
  local key=$1 value=$2
  grep -q "^$key=" .env || die "$key is missing in .env (unexpected Supabase release?)"
  sed -i "s|^$key=.*$|$key=$value|" .env
}

log "3/5 Domain, HTTPS, database access"
set_env SUPABASE_PUBLIC_URL "https://$DOMAIN"
set_env API_EXTERNAL_URL "https://$DOMAIN/auth/v1"
set_env SITE_URL "https://$DOMAIN"
set_env PROXY_DOMAIN "$DOMAIN"
cp "$HERE/docker-compose.moysklad.yml" "$PROJECT/"
sh run.sh config add caddy moysklad >/dev/null

log "4/5 Accounts and functions"
set_env DISABLE_SIGNUP true
set_env ENABLE_ANONYMOUS_USERS false
set_env FUNCTIONS_VERIFY_JWT true
chmod 600 .env
sh run.sh start

log "5/5 Daily backups"
install -d -m 700 /var/backups/moy-sklad /etc/moy-sklad
install -m 700 "$HERE/backup.sh" "$BASE/backup.sh"
cat > /etc/systemd/system/moy-sklad-backup.service <<UNIT
[Unit]
Description=Moy Sklad database backup
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $BASE/backup.sh
UNIT
cat > /etc/systemd/system/moy-sklad-backup.timer <<'UNIT'
[Unit]
Description=Daily Moy Sklad database backup

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now moy-sklad-backup.timer

cat <<DONE

Готово. Supabase работает на https://$DOMAIN

Для сборки приложения (это публичные значения, их можно хранить в настройках сборки):
  EXPO_PUBLIC_SUPABASE_URL=https://$DOMAIN
  EXPO_PUBLIC_SUPABASE_ANON_KEY=$(grep '^ANON_KEY=' .env | cut -d= -f2-)

Дальше:
  1. Примените схему базы: запустите в GitHub «moy-sklad deploy (production)» (см. deploy/README.md).
  2. Создайте владельца: bash $BASE/deploy/create-owner.sh
  3. Пароли сервера: sh $PROJECT/run.sh secrets — сохраните их в менеджере паролей, в чат не присылайте.
DONE

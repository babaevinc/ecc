#!/usr/bin/env bash
# «Мой склад»: creates the company, its owner account and a first warehouse. Run once on the server:
#   bash /opt/moy-sklad/deploy/create-owner.sh
# Asks for the email, password and company name in the terminal; nothing is stored in shell history
# or passed on a command line. The owner then invites staff from the app.
set -euo pipefail

PROJECT=${MS_SUPABASE_DIR:-/opt/moy-sklad/supabase}
die() { printf 'Ошибка: %s\n' "$*" >&2; exit 1; }
[ -f "$PROJECT/.env" ] || die "Supabase не установлен в $PROJECT (сначала install.sh)"
command -v jq >/dev/null || die "нужен jq: apt-get install -y jq"
env_value() { grep "^$1=" "$PROJECT/.env" | head -n1 | cut -d= -f2-; }

public_url=$(env_value SUPABASE_PUBLIC_URL)
service_key=$(env_value SERVICE_ROLE_KEY)
[[ $public_url == https://* ]] || die "SUPABASE_PUBLIC_URL в .env должен начинаться с https://"

read -rp 'Email владельца: ' email
[[ $email =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "это не похоже на email"
read -rsp 'Пароль (не короче 10 символов): ' password; echo
read -rsp 'Пароль ещё раз: ' password2; echo
[ "$password" = "$password2" ] || die "пароли не совпадают"
[ "${#password}" -ge 10 ] || die "пароль короче 10 символов"
read -rp 'Название компании: ' company
if [ -z "${company// /}" ] || [ "${#company}" -gt 120 ]; then die "название — от 1 до 120 символов"; fi

headers=$(mktemp)
trap 'rm -f "$headers"' EXIT
chmod 600 "$headers"
printf 'apikey: %s\nAuthorization: Bearer %s\nContent-Type: application/json\n' "$service_key" "$service_key" > "$headers"

# Supabase Auth admin API: the account is created already confirmed, so no email server is needed.
response=$(jq -n --arg e "$email" --arg p "$password" '{email: $e, password: $p, email_confirm: true}' |
  curl -sS -X POST "$public_url/auth/v1/admin/users" -H "@$headers" --data @-) || die "сервер не ответил: проверьте домен и HTTPS"
user_id=$(printf '%s' "$response" | jq -r '.id // empty')
[[ $user_id =~ ^[0-9a-f-]{36}$ ]] || die "аккаунт не создан: $(printf '%s' "$response" | jq -r '.msg // .message // .error_description // "неизвестная ошибка"')"

(cd "$PROJECT" && docker compose exec -T db psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 \
  -v user_id="$user_id" -v company="$company") <<'SQL'
begin;
with c as (insert into public.companies (name) values (:'company') returning id),
     m as (insert into public.members (company_id, user_id, role) select id, :'user_id'::uuid, 'owner' from c returning company_id)
insert into public.warehouses (company_id, name) select company_id, 'Склад' from m;
commit;
SQL
echo "Готово: компания «$company», владелец $email. Войдите в приложение с этим email и паролем."

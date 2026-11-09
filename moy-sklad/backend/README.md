# Backend «Мой склад»

| Путь | Что это |
|---|---|
| `supabase/migrations/` | Схема, RLS, функции остатков, доставка push (применяются по порядку имён) |
| `supabase/functions/notify/` | Edge Function: отправляет push через Expo |
| `supabase/functions/_shared/push.ts` | Тексты и правила отправки (без зависимостей, тестируется в Node) |
| `supabase/tests/local-auth-shim.sql` | Только для локальных тестов на чистом PostgreSQL. На Supabase не применять |
| `test-api/` | Тестовый API — эталон контракта и цель Playwright, ZAP, Locust |

## Проверка локально

```bash
export MS_ENV=test MS_DB_URL=postgres://postgres:ПАРОЛЬ@127.0.0.1:5432/postgres
npm run test:db                                  # 20 тестов: RLS, роли, остатки, push
node --experimental-strip-types --test tests/unit/push.test.js
```

Тесты создают и удаляют свою временную базу. Шим повторяет права Supabase по умолчанию,
поэтому забытый `revoke` в миграции роняет тесты.

## Развёртывание на своём сервере (вариант B, ADR 0002)

Пошагово — в `deploy/README.md`. Коротко: `moy-sklad-deploy` с ручным утверждением загружает релиз
на сервер по SSH и запускает `deploy/migrate.sh`, который:

1. применяет новые миграции по порядку имён, каждую в одной транзакции, и записывает их
   в `supabase_migrations.schema_migrations`;
2. копирует функцию `notify` (с `_shared/`) в `volumes/functions/` и перезапускает сервис функций;
3. сохраняет в Vault `project_url` (адрес шлюза внутри Docker) и `service_role_key` и ставит ежеминутную
   задачу `moy-sklad-notify` (pg_cron + pg_net), которая вызывает `notify` с ключом service role.
   Другие ключи функция отклоняет с кодом 403: публичный ключ есть в каждом приложении.

Ежедневная проверка партий старше 7 дней (`notify_stale_batches`, 08:00 по Екатеринбургу) создаётся
миграцией сама, если на сервере есть `pg_cron`.

## Известные ограничения

- Если Expo Push недоступен, уже забранные уведомления не отправятся повторно — они остаются в ленте
  приложения. Повторная отправка — в следующей итерации.
- `notify/index.ts` проверен только синтаксически: Deno в среде разработки не было. Логика отправки
  (`_shared/push.ts`) покрыта тестами.

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

## Развёртывание на Supabase (вариант B, ADR 0002)

Выполняет человек или `dev-devops` через `moy-sklad-deploy` с ручным утверждением.

1. Миграции: `supabase db push` (в deploy-workflow).
2. Функция: `supabase functions deploy notify`.
3. Секреты сервера в Vault (один раз, в SQL-редакторе Supabase; значения — из настроек проекта, не из репозитория):

   ```sql
   select vault.create_secret('https://<адрес-проекта>', 'project_url');
   select vault.create_secret('<service role key>', 'service_role_key');
   ```

4. Ежеминутная отправка (нужны расширения `pg_cron` и `pg_net`):

   ```sql
   select cron.schedule('moy-sklad-notify', '* * * * *', $$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/notify',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
       body := '{}'::jsonb)
   $$);
   ```

Ежедневная проверка партий старше 7 дней (`notify_stale_batches`, 08:00 по Екатеринбургу) создаётся
миграцией сама, если на сервере есть `pg_cron`.

## Известные ограничения

- Если Expo Push недоступен, уже забранные уведомления не отправятся повторно — они остаются в ленте
  приложения. Повторная отправка — в следующей итерации.
- `notify/index.ts` проверен только синтаксически: Deno в среде разработки не было. Логика отправки
  (`_shared/push.ts`) покрыта тестами.

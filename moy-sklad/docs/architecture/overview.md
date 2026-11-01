# Архитектура «Мой склад»

```text
iPhone / Android (Expo, React Native, TypeScript)
   │  HTTPS, JWT сессии Supabase Auth
   ▼
Supabase ─ Auth (логин + пароль)
         ─ PostgreSQL + RLS (данные компаний, роли)
         ─ RPC-функции: ship_request, write_off, move_stock, apply_stock_count
         ─ Edge Functions: notify (push), delete-account
         ─ pg_cron: ежедневная проверка партий старше 7 дней
   │
   ▼
Expo Push Service → APNs (Apple) / FCM (Google)
```

## Модули приложения (`app/`)

| Модуль | Экраны | Требования |
|---|---|---|
| auth | вход, восстановление пароля, удаление аккаунта | R1, R13 |
| home | быстрые действия, остатки по количеству, предупреждения | R5 |
| stock | склады, партии, перемещение, порча, пересчёт | R5, R8, R9 |
| receive | приход | R4 |
| ship | заявки, продажа без заявки, цены дня | R6, R7, R10 |
| notifications | лента, регистрация push-токена | R12 |
| settings | склады, ассортимент (перетаскивание), сотрудники, роли | R2, R3 |
| admin | компании (только супер-админ) | R2 |

## Принципы

- Все изменения остатков — только через RPC-функции в базе (атомарно, с проверкой прав); приложение не пишет в `batches`/`movements` напрямую.
- Контракт API и ответы прав сначала фиксируются в тестовом API `backend/test-api/` и его тестах, затем реализуются в Supabase.
- Тестовые данные — только вымышленные. Production — только через deploy-workflow с ручным утверждением.

## Решения

- [ADR 0001 — стек Expo + Supabase](../adr/0001-stack-expo-supabase.md)
- [ADR 0002 — где хранить данные](../adr/0002-data-residency.md) — **ждёт решения владельца**
- [ADR 0003 — вход и уведомления](../adr/0003-auth-and-push.md)

См. также [роли](roles.md), [модель данных](data-model.md), [требования MVP](../requirements/mvp.md).

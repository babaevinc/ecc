# Модель данных (PostgreSQL / Supabase)

Перенос модели работающего веб-приложения: остаток не хранится, а вычисляется как
`партия.количество − сумма движений по партии (кроме отменённых)`. Так история операций всегда сходится с остатком.

## Таблицы

| Таблица | Ключевые поля | Примечание |
|---|---|---|
| `companies` | `id`, `name`, `blocked_at` | Арендатор. Всё ниже имеет `company_id` |
| `platform_admins` | `user_id` | Супер-админы. Отдельная таблица, а не роль в компании |
| `members` | `company_id`, `user_id` → `auth.users`, `role` (`owner`/`staff`/`manager`/`viewer`), `warehouse_ids uuid[]` | Пустой список складов = все склады |
| `warehouses` | `company_id`, `name`, `kind` (`warehouse`/`market_point`), `archived` | |
| `products` | `company_id`, `name`, `unit` (`box`/`kg`), `sort_order`, `archived` | Единицу нельзя менять при наличии операций |
| `batches` | `company_id`, `warehouse_id`, `product_id`, `qty numeric(12,3)`, `received_on date`, `supplier`, `unit_cost`, `source_batch_id`, `kind` (`receipt`/`move_in`/`surplus`) | При перемещении `received_on` копируется — возраст партии сохраняется |
| `movements` | `company_id`, `batch_id`, `qty`, `kind` (`ship`/`sale`/`move_out`/`shortage`/`waste`), `price`, `markdown bool`, `reason`, `request_id`, `voided_at`, `voided_by` | Отмена — пометка, не удаление |
| `requests` | `company_id`, `number`, `warehouse_id`, `client`, `status` (`new`/`in_progress`/`done`/`cancelled`), `created_by`, `status_by`, `status_at` | Номер уникален в пределах компании |
| `request_lines` | `request_id`, `product_id`, `qty`, `batch_id null`, `price` | Резерв = строки заявок `new`/`in_progress` |
| `stock_counts` | `company_id`, `warehouse_id`, `lines jsonb`, `status` (`pending`/`applied`/`rejected`), `reason` | Пересчёт, утверждает владелец |
| `daily_prices` | `company_id`, `product_id`, `price_date`, `price` | Уникально: компания + товар + дата |
| `push_tokens` | `user_id`, `token`, `platform`, `updated_at` | Expo push token устройства |
| `notifications` | `company_id`, `user_id`, `kind`, `payload jsonb`, `read_at` | Лента в приложении |
| `audit_log` | `company_id`, `actor`, `action`, `entity`, `entity_id`, `at` | Заполняется триггерами |

Таблицы финансов (`payments`, `expenses`) — после MVP.

## Индексы под главные запросы

- `batches (company_id, warehouse_id, product_id, received_on)` — остатки и FIFO.
- `movements (batch_id) where voided_at is null` — расчёт остатка.
- `requests (company_id, status, created_at desc)` — активные заявки.
- `batches (company_id, received_on)` — партии старше 7 дней.

## Безопасность на уровне базы (RLS)

- Включена на всех таблицах. Политика по умолчанию — запрет.
- `company_id = any(public.my_companies())` для чтения; запись дополнительно проверяет `public.my_role(company_id)`.
- Супер-админ определяется функцией `public.is_platform_admin()` по `platform_admins`.
- Остаток и FIFO-списание выполняются функциями `security definer` (`ship_request`, `write_off`, `move_stock`) в одной транзакции с блокировкой партий, чтобы два кладовщика не списали одну коробку дважды.
- Закупочные цены (`unit_cost`) отдаются через представление, которое скрывает их от всех, кроме `owner`.

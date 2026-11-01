# «Мой склад» — команда ИИ-агентов

Двенадцать специализированных агентов и оркестратор для разработки, сборки, тестирования и аудита
безопасности мобильного приложения учёта зелени «Мой склад».

## Команда

| Агент | Группа | Модель | Стадия проверки | Чем занимается |
|---|---|---|---|---|
| `dev-architect` | разработка | opus | — | Архитектура, роли, ADR, задания с критериями приёмки |
| `dev-frontend` | разработка | sonnet | — | Expo / React Native, экраны в стиле iOS |
| `dev-backend` | разработка | sonnet | исправляет `semgrep`, `access-control`, `red-team`, `zap`, `load` | API, вход, роли, уведомления |
| `dev-database` | разработка | sonnet | исправляет `db` | Миграции, RLS, функции остатков |
| `dev-devops` | разработка | sonnet | исправляет `deps` | CI, сборка EAS, окружения |
| `dev-debug` | разработка | sonnet | исправляет `unit`, `e2e` | Корневая причина + регрессионный тест |
| `sec-pentest` | проверка | sonnet | `zap` | OWASP ZAP baseline, разбор находок |
| `sec-red-team` | проверка | opus | `red-team` | Сценарии злоупотреблений как тесты |
| `sec-auditor` | проверка | sonnet | `semgrep`, `deps` | Статический анализ, зависимости, workflow |
| `sec-access-control` | проверка | sonnet | `access-control`, `db` | Матрица «роль × действие», изоляция компаний в API и в базе |
| `qa-load` | проверка | sonnet | `load` | Locust, пороги скорости и ошибок |
| `qa-automation` | проверка | sonnet | `unit`, `e2e` | node:test и Playwright по критериям приёмки |
| `orchestrator` | координация | opus | все | Ведёт цикл и раздаёт задания |

Обязанности, инструменты, ограничения, входы и выходы каждого — в `.claude/agents/<id>.md`;
машиночитаемый контракт (кто владеет стадией, кто исправляет) — в `orchestrator/team.json`.

## Цикл

```text
разработка ──► тестирование ──► обнаружение ──► исправление ──► повторная проверка
 dev-*          node orchestrator/run.js   reports/findings.json   --dispatch handoff|claude   тот же run.js
                                                                  (.orchestrator/inbox + ecc memory)
```

| Код выхода `run.js` | Значение |
|---|---|
| `0` | Все выбранные стадии зелёные (пропущенные перечислены отдельно) |
| `1` | Остались ошибки, ограничитель отказал или `--strict` и не хватает инструментов |
| `3` | Находки переданы исполнителям, ждём исправлений |

## Границы испытаний

- Активные проверки (ZAP, Locust, Red Team) — только на адресах из `orchestrator/scope.json`
  (`127.0.0.1:8787`, `localhost:8787`, `host.docker.internal:8787`). Менять файл — только владелец.
- `orchestrator/guard.js` проверяет окружение (`MS_ENV=local|test|ci`, нет переменных `*PROD*`,
  база только локальная), цель, лимиты нагрузки и запрещает разрушительные команды. Он подключён:
  в оркестраторе, в Playwright, в Locust, хуком Claude Code (`.claude/settings.json`) и хуком Hermes.
- Тестовые данные только вымышленные (`backend/test-api/fixtures.js`).
- Production — только через `.github/workflows/moy-sklad-deploy.yml` с ручным утверждением.

## Состав

```text
.claude/agents/        13 агентов
.claude/settings.json  хук guard.js + запреты опасных команд
orchestrator/          team.json, scope.json, guard.js, run.js, hermes/
backend/test-api/      тестовый API — эталон контракта и цель проверок
tests/unit/            node:test — ограничитель, оркестратор, конфигурации агентов
tests/e2e/             Playwright — api, access-control, abuse (Red Team)
tests/load/            Locust
tests/security/        правила Semgrep
docs/WINDOWS-SETUP.md  установка и запуск на Windows
```

Workflow лежат в корне репозитория: `.github/workflows/moy-sklad-ci.yml`, `moy-sklad-security.yml`,
`moy-sklad-deploy.yml`.

## Быстрый старт

```bash
cd moy-sklad
npm install --ignore-scripts
export MS_ENV=local            # PowerShell: $env:MS_ENV = "local"
npm test
node orchestrator/run.js --dispatch none
```

Подробно для Windows — [docs/WINDOWS-SETUP.md](docs/WINDOWS-SETUP.md).
Hermes — [orchestrator/hermes/README.md](orchestrator/hermes/README.md).

## Архитектура

- [Требования MVP](docs/requirements/mvp.md)
- [Обзор архитектуры](docs/architecture/overview.md), [роли и права](docs/architecture/roles.md), [модель данных](docs/architecture/data-model.md)
- Решения: [0001 стек](docs/adr/0001-stack-expo-supabase.md), [0002 где хранить данные](docs/adr/0002-data-residency.md) (ждёт решения владельца), [0003 вход и уведомления](docs/adr/0003-auth-and-push.md)

## Что дальше

`app/` (Expo) и `backend/supabase/` ещё не созданы. Следующие задачи: `dev-database` — схема и RLS
по `data-model.md`, затем `dev-backend` и `dev-frontend` по контракту тестового API.

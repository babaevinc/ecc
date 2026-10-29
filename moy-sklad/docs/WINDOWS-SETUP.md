# Установка и запуск команды «Мой склад» на Windows

Инструкция для Windows 10/11 и PowerShell. Команды вводятся в PowerShell, открытом **от имени
обычного пользователя** (администратор нужен только для установки программ).

## 1. Установите программы

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Python.Python.3.12 -e
winget install --id Docker.DockerDesktop -e
```

Закройте и снова откройте PowerShell, затем проверьте версии:

```powershell
git --version
node --version      # нужна 22 или новее
py --version        # 3.12
docker --version
```

Запустите **Docker Desktop** из меню «Пуск» и дождитесь статуса «Engine running» — без него стадия ZAP
будет пропущена.

Если PowerShell не даёт запускать `npm`/`npx` («running scripts is disabled»):

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## 2. Установите Claude Code и ECC

```powershell
npm install -g @anthropic-ai/claude-code
claude --version
npm install -g ecc-universal     # даёт команду ecc (общая память агентов и связь с Hermes)
ecc --help
```

Войдите в Claude Code: выполните `claude` и следуйте подсказкам входа.

## 3. Получите проект

```powershell
cd $HOME
git clone https://github.com/babaevinc/ecc.git
cd ecc
git checkout feat/moy-sklad-agent-team
cd moy-sklad
npm install --ignore-scripts
```

## 4. Установите инструменты проверок

```powershell
py -m pip install locust==2.32.4
locust --version
```

**Semgrep** официально рассчитан на Linux и macOS. На Windows его удобнее запускать в CI
(он запускается автоматически) или в WSL. Без него локальная стадия `semgrep` будет помечена как
«пропущена» — это честный статус, не «пройдено».

## 5. Задайте тестовое окружение

Команда работает **только** при тестовом окружении. В каждом новом окне PowerShell:

```powershell
$env:MS_ENV = "local"
```

Не задавайте переменные с `PROD` в имени и не указывайте `DATABASE_URL` на боевой сервер —
ограничитель откажется работать.

Проверка:

```powershell
node orchestrator/guard.js --target http://127.0.0.1:8787
# OK: environment "local", target http://127.0.0.1:8787 is within scope
```

## 6. Запустите проверки

```powershell
npm test                                   # юнит-тесты (29 шт.)
node orchestrator/run.js --dispatch none   # все стадии один раз, без передачи заданий
```

Оркестратор сам запускает тестовый API на `127.0.0.1:8787`, а ZAP в Docker обращается к нему через
`host.docker.internal:8787` (адрес уже разрешён в `orchestrator/scope.json`).

Отчёты: `reports\summary.md` (сводка), `reports\findings.json` (находки),
`reports\playwright\index.html` (Playwright), `reports\zap-baseline.html` (ZAP), `reports\locust_stats.csv`.

Только часть стадий:

```powershell
node orchestrator/run.js --stages unit,e2e,access-control --dispatch none
```

## 7. Цикл «проверка → исправление → повторная проверка»

**Вариант A — задания для агентов (по умолчанию):**

```powershell
node orchestrator/run.js
```

Находки попадают в `.orchestrator\inbox\<исполнитель>\` и в общую память ECC
(`ecc memory search "moy-sklad" --target-harness dev-backend`). После исправления запустите ту же
команду ещё раз — это и есть повторная проверка. Код выхода `3` значит «задания переданы, ждём исправлений».

**Вариант B — агенты исправляют сами:**

```powershell
node orchestrator/run.js --dispatch claude
```

Для каждой находки запускается `claude -p --agent <исполнитель> --permission-mode acceptEdits`, затем
проверка повторяется, не больше 3 раз подряд. Просматривайте изменения через `git diff` перед коммитом.

## 8. Работа с агентами в Claude Code

```powershell
cd $HOME\ecc\moy-sklad
claude
```

Внутри Claude Code:

- `/agents` — список 13 агентов команды;
- «Используй агента orchestrator и запусти полный цикл проверок»;
- «Агент dev-architect: спроектируй экран прихода с ролями».

Защита работает автоматически: `moy-sklad\.claude\settings.json` подключает `guard.js` перед каждой
командой Bash и запрещает force-push, `supabase db push`, `eas submit` и правку `scope.json`.

## 9. Hermes (по желанию)

Hermes устанавливается по его собственной документации. Если он работает в WSL, все пути в
`~/.hermes/config.yaml` указывайте Linux-путями (`/mnt/c/Users/<вы>/ecc/...`). Подключение —
в `orchestrator/hermes/README.md`.

## 10. Настройка GitHub для CI и ручного утверждения

1. **Settings → Environments → New environment** → имя `production`.
2. В `production` включите **Required reviewers** и добавьте себя (и при желании второго человека).
3. В том же окружении добавьте секреты: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`,
   `SUPABASE_PROJECT_REF`, `EXPO_TOKEN`.
4. В **Settings → Secrets and variables → Actions** добавьте `EXPO_TOKEN` для тестовых сборок.

Развёртывание: **Actions → moy-sklad deploy (production) → Run workflow**, введите `DEPLOY`.
Workflow заново прогонит проверки и остановится, пока проверяющий не нажмёт **Approve**.

## Если что-то не работает

| Симптом | Что сделать |
|---|---|
| `DENY: MS_ENV=""` | `$env:MS_ENV = "local"` в текущем окне |
| `zap … not available: docker daemon` | Запустите Docker Desktop |
| `locust … not available` | `py -m pip install locust==2.32.4`, перезапустите PowerShell |
| Порт 8787 занят | `netstat -ano \| findstr 8787`, завершите процесс или остановите старый тестовый API |
| `test API did not start` | `node backend/test-api/server.js` с `$env:MS_ENV="local"` и прочитайте ошибку |

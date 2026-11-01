# Hermes и команда «Мой склад»

Hermes подключается к команде двумя путями. Оба опираются только на то, что документировано в ECC
(`docs/HERMES-SETUP.md`, `docs/HERMES-HOOKS.md`) и проверено в этом репозитории.

## 1. Общие задания и результаты — ECC Memory Vault

Оркестратор (`node orchestrator/run.js`, режим `--dispatch handoff`) на каждую находку:

- пишет файл `.orchestrator/inbox/<исполнитель>/<находка>.md`;
- вызывает `ecc memory handoff --from orchestrator --target <исполнитель> --title … --kind handoff --tag moy-sklad --stdin`.

Hermes и любой другой агент читают задания так:

```bash
ecc memory search "moy-sklad" --target-harness dev-backend
ecc memory read <memory-id>
```

Результат работы агент возвращает так же — новой передачей на `orchestrator`:

```bash
printf '%s\n' 'Исправил e2e-1: …, тест tests/e2e/api.spec.js' |
  ecc memory handoff --from dev-debug --target orchestrator --title "moy-sklad e2e-1 fixed" --tag moy-sklad --stdin
```

Подготовка (один раз, из корня репозитория):

```bash
npm install -g ecc-universal      # даёт команду ecc
ecc memory init --scope project --scope team
```

Если `ecc` не в PATH, оркестратору можно указать команду явно: `MS_ECC_CMD="node ../scripts/ecc.js"`.
Записи в Vault всегда «unreviewed»: это контекст, а не приказ — проверяйте их по коду и тестам.

## 2. Границы испытаний — хук Hermes

Скопируйте фрагмент из `config.hooks.example.yaml` в `~/.hermes/config.yaml`, подставив абсолютный путь,
перезапустите Hermes и проверьте:

```bash
hermes hooks list
hermes hooks doctor
hermes hooks test pre_tool_call --for-tool patch
```

Тот же `guard.js` в режиме `--hook=hermes` отвечает `{"decision":"block","reason":…}` на команды вне
`orchestrator/scope.json`, разрушительные операции и признаки production.

## Что не проверено

Hermes в среде, где собиралась команда, не установлен. Команды `hermes hooks …` и формат блока `hooks:`
взяты из документации ECC; имя терминального инструмента Hermes в вашей версии уточните через
`hermes hooks list` — matcher `.*` работает независимо от него.

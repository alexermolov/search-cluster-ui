# Search Cluster UI

Desktop-клиент для подключения и просмотра кластеров **Elasticsearch** и **OpenSearch**:
обзор здоровья кластера, список индексов с деталями (маппинги, настройки, документы) и консоль запросов.

## Стек

| Слой | Технология | Почему |
|---|---|---|
| Оболочка | Electron 33 | единственный кроссплатформенный desktop-вариант с полноценным Node в main-процессе |
| Язык | TypeScript 5 (strict) | единый язык и типы для main/preload/renderer |
| Renderer | React 18 + Zustand | минимальный, знакомый большинству стек состояния |
| Сборка renderer | Vite 5 | мгновенный HMR, простая конфигурация |
| Сборка main/preload | esbuild | bundle в CJS за миллисекунды, никаких лишних тулзов |
| HTTP к кластерам | `node:https` (только main-процесс) | контроль TLS-верификации и таймаутов без зависимостей |
| AWS SigV4 | собственная реализация (~60 строк) | не тянем aws-sdk ради одной подписи |
| Хранение подключений | JSON в `userData` + `safeStorage` | пароли шифруются ключами ОС |

Рантайм-зависимости — только `react`, `react-dom`, `zustand`. Всё остальное — devDependencies.

## Установка

### 1. Зависимости

```bash
npm install
```

> **npm ≥ 11 блокирует postinstall-скрипты по умолчанию.** Если после `npm install` бинарник не появился —
> разрешите скрипты и запустите установку вручную:
> ```bash
> npm install-scripts approve electron
> node node_modules/electron/install.js
> ```
> Если GitHub/CDN недоступен и скачивание падает:
> ```bash
> # cmd
> set ELECTRON_SKIP_BINARY_DOWNLOAD=1 && npm install
> # PowerShell
> $env:ELECTRON_SKIP_BINARY_DOWNLOAD=1; npm install
> ```
> и разместите бинарник вручную (см. п. 2). Можно также попробовать зеркало:
> ```bash
> ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js
> ```

### 2. Electron (ручное размещение в node_modules)

Если `npm install` не смог скачать бинарник Electron (он качается с GitHub Releases, а не из npm), сделайте так:

1. **Скачайте zip-архив** под вашу платформу со страницы релизов:
   `https://github.com/electron/electron/releases`
   — файл `electron-v33.4.11-win32-x64.zip` для Windows x64 (версия должна соответствовать установленной в `node_modules/electron/package.json` — сейчас это 33.4.11; для macOS — `darwin-arm64`/`darwin-x64`, для Linux — `linux-x64`).

2. **Распакуйте содержимое архива** в `node_modules\electron\dist\` — так, чтобы `electron.exe` лежал прямо в `dist`:
   ```
   node_modules/electron/dist/electron.exe
   node_modules/electron/dist/*.dll
   node_modules/electron/dist/resources/default_app.asar
   ...
   ```

3. **Создайте файл `node_modules\electron\path.txt`** с одной строкой — именем исполняемого файла:
   ```cmd
   echo electron.exe> node_modules\electron\path.txt
   ```
   (на macOS/Linux — `electron` без расширения)

4. **Проверьте**:
   ```bash
   node -e "console.log(require('electron'))"
   ```
   Должен напечататься путь к существующему `electron.exe`.

Альтернативы:
- **Зеркало** (если доступен npm, но не GitHub): создайте `.npmrc` с
  `electron_mirror=https://npmmirror.com/mirrors/electron/` и запустите `npm install`.
- **Кеш**: можно положить zip в кеш `@electron/get` (`%LOCALAPPDATA%\electron\Cache` на Windows,
  `~/.cache/electron` на Linux) — тогда обычный `npm install` возьмёт архив из кеша.

## Запуск и сборка

```bash
npm run dev        # dev-режим: Vite (renderer, HMR) + esbuild watch (main/preload) + Electron
npm run typecheck  # строгая проверка типов: main/preload и renderer отдельно
npm run build      # прод-сборка в dist/ (esbuild + vite build)
npm start          # запуск собранного приложения
```

В dev-режиме пересборка main/preload автоматически перезапускает приложение.

## Возможности

- **Подключения**: несколько кластеров; Basic / Bearer (API key) / AWS SigV4 / без аутентификации;
  опции «не проверять TLS» и таймаут; проверка соединения кнопкой Test.
- **Overview**: статус кластера, шардые метрики, версия, таблица нод (роли, heap/RAM/disk).
- **Indices**: список с фильтром; по клику — детали: документы (превью), aliases (чипы с удалением), mappings, settings; управление индексом: delete / open / close, добавление и удаление aliases, reindex в другой индекс (с опциональным расширенным JSON и отчётом).
- **Query**: консоль — индекс-паттерн + тело запроса (query DSL / aggs), Ctrl+Enter — выполнение; результаты в виде таблицы или JSON, пагинация (from/size, выбор размера страницы), подсветка совпадений (highlight), история запросов и сохранённые сниппеты (localStorage), автодополнение полей индекса и ключей query DSL, кнопка Format.
- **Documents**: просмотр и редактирование документа в JSON-редакторе (PUT `_doc/{id}`), создание документа с автогенерацией ID (POST `_doc`), bulk-импорт NDJSON (вставка или выбор файла, отчёт по каждому item: created/updated/failed).
- **Export**: экспорт всех совпадений запроса в CSV или JSON (scroll, нативный диалог сохранения файла) из панели Query; редактирование документа прямо из результатов (Edit).
- **Shards**: таблица шардов кластера с фильтром по индексу/ноду и сводкой (primaries / replicas / unassigned).
- **Snapshots**: снапшоты по всем репозиториям — статус, индексы, время и длительность, с фильтром.

## Безопасность

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` — рендерер изолирован.
- Рендерер **никогда** не ходит в сеть сам: только IPC → main → кластер.
- Весь IPC-интерфейс перечислен явно в `src/shared/ipc.ts` и `src/preload/index.ts`.
- CSP в проде: без remote-скриптов; в dev meta-тег снимается (иначе React-refresh не работает).
- Пароли шифруются через `safeStorage` (ключи ОС). Если ОС-хранилище недоступно — base64-fallback
  (помечено в файле, лучше включить шифрование). При редактировании подключения секреты
  расшифровываются и передаются в рендерер по IPC — это осознанный компромисс локального
  desktop-приложения.

## Архитектура

См. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — слои, IPC-контракт и точки расширения
(новый flavor кластера, новая панель, новый канал IPC).

## CI: вендинг Electron

Раннеры GitLab CI не могут установить Electron обычным путём:

- npm-тарболл `electron` блокируется CodeScoring на Nexus (403);
- бинарник с GitHub Releases / зеркал недоступен с раннера (нет внешней сети).

Поэтому оба артефакта **один раз** загружаются в Generic Package Registry
этого проекта, а в CI их ставит `scripts/ci-setup-electron.mjs`:

| Артефакт | Package name | Версия | Файл |
|---|---|---|---|
| npm-пакет electron (типы, `package.json`) | `vendor-npm` | версия electron, напр. `33.4.11` | `electron-<ver>.tgz` |
| win32-x64 рантайм (`dist/`) | `vendor-electron` | версия electron | `electron-win32-x64-<ver>.tar.gz` |

### Одноразовая загрузка (с машины с доступом)

На Windows всё то же самое делает один скрипт: `scripts/upload-electron-vendor.ps1`
(см. комментарий в начале скрипта). Ниже — то же самое вручную, для любой платформы.

Нужен токен с правом `write_repository` (Personal/Project Access Token).
Project ID — из настроек проекта (Settings → General).

```bash
VER=33.4.11   # должна совпадать с версией electron в package-lock.json (packages."node_modules/electron".version)
PID=<project-id>
GITLAB=https://gitlab.services.mts.ru

# 1. npm-тарболл — восстанавливаем из локального node_modules/electron
#    (Nexus отдаёт electron с 403 везде — CodeScoring блокирует и рабочие машины;
#    npm-тарболл electron — это просто папка package/ с теми же файлами)
STAGE=$(mktemp -d)/package
mkdir -p "${STAGE}"
cp -r node_modules/electron/. "${STAGE}/"
rm -rf "${STAGE}/dist" "${STAGE}/path.txt" "${STAGE}/node_modules"
tar -C "$(dirname "${STAGE}")" -czf "electron-${VER}.tgz" package

# 2. win32-рантайм из локального node_modules/electron/dist
tar -C node_modules/electron -czf "electron-win32-x64-${VER}.tar.gz" dist

# 3. Загрузка в Package Registry
curl --header "PRIVATE-TOKEN: <token>" --upload-file "electron-${VER}.tgz" \
  "${GITLAB}/api/v4/projects/${PID}/packages/generic/vendor-npm/electron/${VER}/electron-${VER}.tgz"

curl --header "PRIVATE-TOKEN: <token>" --upload-file "electron-win32-x64-${VER}.tar.gz" \
  "${GITLAB}/api/v4/projects/${PID}/packages/generic/vendor-electron/electron/${VER}/electron-win32-x64-${VER}.tar.gz"
```

### Обновление версии Electron

1. Обновите `devDependencies.electron` в `package.json` (локально `npm install`).
2. Повторите загрузку артефактов с новым `VER` (см. выше).
3. Скрипт `ci-setup-electron.mjs` сам возьмёт версию из `package-lock.json` —
   в CI ничего менять не нужно.

### Как это работает в CI

`scripts/ci-setup-electron.mjs`:

1. удаляет `electron` из `package.json` (чтобы npm не качал его через Nexus);
2. ставит остальные зависимости (`npm install`, lockfile соблюдается);
3. скачивает npm-тарболл electron из Package Registry и распаковывает
   в `node_modules/electron` (нужен для `typecheck` и `package-win.mjs`);
4. с флагом `--runtime` дополнительно распаковывает win32-рантайм
   в `node_modules/electron/dist` + создаёт `path.txt`.

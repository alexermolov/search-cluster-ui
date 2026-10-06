import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

/**
 * Подготовка Electron в GitLab CI без внешних сетевых источников.
 *
 * Проблема: npm-тарболл electron блокируется CodeScoring на Nexus (403),
 * а бинарник с GitHub/зеркал недоступен с раннера. Поэтому оба артефакта
 * один раз загружаются в Generic Package Registry этого проекта
 * (см. README, раздел «CI: вендинг Electron»), а этот скрипт:
 *
 *   1) убирает electron из package.json (npm не должен качать его через Nexus);
 *   2) запускает `npm install` для остальных зависимостей;
 *   3) скачивает npm-тарболл electron из Package Registry и распаковывает
 *      в node_modules/electron (типы для typecheck + версия для package-win);
 *   4) с флагом --runtime дополнительно распаковывает win32-рантайм
 *      в node_modules/electron/dist — то, что ожидает scripts/package-win.mjs.
 *
 * Использование: node scripts/ci-setup-electron.mjs [--runtime]
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const withRuntime = process.argv.includes('--runtime')

// ── 0. Окружение GitLab CI ────────────────────────────────────────────────────
const { CI_API_V4_URL, CI_PROJECT_ID, CI_JOB_TOKEN } = process.env
if (!CI_API_V4_URL || !CI_PROJECT_ID || !CI_JOB_TOKEN) {
  console.error('Скрипт рассчитан на запуск в GitLab CI: нужны CI_API_V4_URL, CI_PROJECT_ID, CI_JOB_TOKEN')
  process.exit(1)
}

// ── 1. Версия electron: точная — из lockfile, fallback — package.json ────────
// ВАЖНО: в package.json диапазон (^33.4.0), а вендорятся в Package Registry
// артефакты конкретной версии из lockfile (33.4.11) — берём её оттуда.
const pkgPath = path.join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
let version
try {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  version = lock.packages?.['node_modules/electron']?.version
} catch {
  // lockfile недоступен — попробуем диапазон из package.json
}
if (!version) {
  version = pkg.devDependencies?.electron?.match(/\d+\.\d+\.\d+/)?.[0]
}
if (!version) {
  console.error('Версия electron не найдена ни в package-lock.json, ни в package.json')
  process.exit(1)
}

// ── 2. Убираем electron из package.json: npm не должен качать его через Nexus
//       (CodeScoring блокирует тарболл). Сам пакет ставим из Package Registry.
delete pkg.devDependencies.electron
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

// ── 3. Остальные зависимости — обычным npm install (lockfile соблюдается) ─────
const install = spawnSync('npm install --no-audit --no-fund', {
  stdio: 'inherit',
  shell: true,
  cwd: root,
})
if (install.status !== 0) process.exit(install.status ?? 1)

// ── 4. Хелперы ────────────────────────────────────────────────────────────────
function run(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', cwd: root })
  if (res.status !== 0) process.exit(res.status ?? 1)
}

function download(url, outFile) {
  console.log(`Downloading ${url}`)
  run('curl', [
    '--fail',
    '--silent',
    '--show-error',
    '--location',
    '--header',
    `JOB-TOKEN: ${CI_JOB_TOKEN}`,
    '--output',
    outFile,
    url,
  ])
}

function extract(tgz, dest, strip) {
  const args = ['-xzf', tgz, '-C', dest]
  if (strip > 0) args.push('--strip-components', String(strip))
  run('tar', args)
}

const electronDir = path.join(root, 'node_modules', 'electron')
const registry = `${CI_API_V4_URL}/projects/${CI_PROJECT_ID}/packages/generic`

// ── 5. npm-пакет electron (типы для typecheck, версия для package-win) ───────
const npmTgz = path.join(root, 'electron-npm.tgz')
download(`${registry}/vendor-npm/electron/${version}/electron-${version}.tgz`, npmTgz)
rmSync(electronDir, { recursive: true, force: true })
mkdirSync(electronDir, { recursive: true })
extract(npmTgz, electronDir, 1) // в тарболле всё лежит в package/
rmSync(npmTgz, { force: true })

// ── 6. Win32-рантайм (node_modules/electron/dist для package-win.mjs) ────────
if (withRuntime) {
  const runtimeTgz = path.join(root, 'electron-runtime.tgz')
  download(`${registry}/vendor-electron/electron/${version}/electron-win32-x64-${version}.tar.gz`, runtimeTgz)
  extract(runtimeTgz, electronDir, 0) // в архиве папка dist/
  rmSync(runtimeTgz, { force: true })
  writeFileSync(path.join(electronDir, 'path.txt'), 'electron.exe')
}

console.log(`Electron ${version} готов: node_modules/electron${withRuntime ? ' + dist (win32-x64)' : ''}`)

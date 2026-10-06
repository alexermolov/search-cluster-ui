import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outDir = path.join(root, 'release', 'win')
const exeName = 'SearchClusterUI.exe'

// 1. Прод-сборка (esbuild main/preload + vite renderer -> dist/)
const res = spawnSync('npm run build', { stdio: 'inherit', shell: true, cwd: root })
if (res.status !== 0) process.exit(res.status ?? 1)

// 2. Рантайм Electron из node_modules (см. README: бинарник может быть размещён вручную)
const electronDist = path.join(root, 'node_modules', 'electron', 'dist')
if (!existsSync(path.join(electronDist, 'electron.exe'))) {
  console.error('electron.exe не найден в node_modules/electron/dist — см. README, раздел про ручное размещение бинарника')
  process.exit(1)
}

// 3. Чистим и копируем рантайм
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
cpSync(electronDist, outDir, { recursive: true })

// 4. Приложение кладём обычной папкой resources/app (без asar):
//    main/preload бандлятся esbuild'ом, renderer — vite'ом, рантайм-зависимостей в app не нужно.
rmSync(path.join(outDir, 'resources', 'default_app.asar'), { force: true })
const appDir = path.join(outDir, 'resources', 'app')
mkdirSync(appDir, { recursive: true })
cpSync(path.join(root, 'dist'), path.join(appDir, 'dist'), { recursive: true })
writeFileSync(
  path.join(appDir, 'package.json'),
  JSON.stringify(
    {
      name: 'opensearch-ui',
      productName: 'Search Cluster UI',
      version: '0.1.0',
      main: 'dist/main/index.js',
    },
    null,
    2,
  ),
)

// 5. Переименовываем exe
renameSync(path.join(outDir, 'electron.exe'), path.join(outDir, exeName))

console.log(`Windows package complete -> release/win/${exeName}`)

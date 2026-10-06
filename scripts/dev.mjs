import { context } from 'esbuild'
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'

const require = createRequire(import.meta.url)

function resolveElectron() {
  let p
  try {
    p = require('electron')
  } catch {
    console.error('Electron npm package is not installed. Run npm install first (see README).')
    process.exit(1)
  }
  if (!p || !fs.existsSync(p)) {
    console.error(
      `Electron binary not found (expected at "${p}").\n` +
        'Place the Electron binaries manually: see "Installing Electron" in README.md.',
    )
    process.exit(1)
  }
  return p
}

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
}

// Two contexts (main + preload); once both have built once we launch Electron.
// Any rebuild afterwards restarts the app.
let buildsFinished = 0
let started = false
let child = null
let restartTimer = null

function maybeStart() {
  buildsFinished += 1
  if (!started) {
    if (buildsFinished < 2) return
    started = true
    launch()
  } else {
    if (restartTimer) clearTimeout(restartTimer)
    restartTimer = setTimeout(launch, 250)
  }
}

function launch() {
  if (child) {
    child.kill()
    child = null
  }
  const rendererUrl = vite.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/'
  child = spawn(resolveElectron(), ['.'], {
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RENDERER_URL: rendererUrl },
  })
  child.on('exit', (code) => {
    child = null
    shutdown(code ?? 0)
  })
}

let vite

function shutdown(code) {
  if (restartTimer) clearTimeout(restartTimer)
  void mainCtx.dispose()
  void preloadCtx.dispose()
  void vite.close()
  process.exit(code)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

const restartPlugin = {
  name: 'restart-electron',
  setup(build) {
    build.onEnd(() => maybeStart())
  },
}

const mainCtx = await context({
  ...common,
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main/index.js',
  plugins: [restartPlugin],
})

const preloadCtx = await context({
  ...common,
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist/preload/index.js',
  plugins: [restartPlugin],
})

vite = await createServer({ configFile: 'vite.renderer.config.ts' })
await vite.listen()

await mainCtx.watch()
await preloadCtx.watch()

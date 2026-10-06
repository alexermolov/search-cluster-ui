import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'

const common = {
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['electron'],
  sourcemap: false,
}

await build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main/index.js' })
await build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload/index.js' })

const res = spawnSync('npx vite build --config vite.renderer.config.ts', {
  stdio: 'inherit',
  shell: true,
})
if (res.status !== 0) process.exit(res.status ?? 1)

console.log('Build complete -> dist/ (run with: npm start)')

import { build } from 'esbuild'
import { build as viteBuild } from 'vite'

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

await viteBuild({ configFile: 'vite.renderer.config.ts' })

console.log('Build complete -> dist/ (run with: npm start)')

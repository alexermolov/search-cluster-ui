import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
)

/**
 * In dev the CSP meta tag must be dropped: @vitejs/plugin-react injects an
 * inline module script (react-refresh preamble) which `script-src 'self'`
 * would block. The tag stays in the production build (see src/renderer/index.html).
 */
const stripCspInDev = (): Plugin => ({
  name: 'strip-csp-in-dev',
  apply: 'serve',
  transformIndexHtml(html) {
    return html.replace(/<meta http-equiv="Content-Security-Policy".*?>/, '')
  },
})

export default defineConfig({
  root: 'src/renderer',
  plugins: [react(), stripCspInDev()],
  // relative base so the built index.html works via win.loadFile()
  base: './',
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
  },
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: {
      // ESM-only resolution workaround for CI (Windows + CJS Vite build)
      'react-markdown': fileURLToPath(new URL('./node_modules/react-markdown/index.js', import.meta.url)),
    },
  },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
})

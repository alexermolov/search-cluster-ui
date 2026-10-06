import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

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
  server: { port: 5173, strictPort: true },
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
  },
})

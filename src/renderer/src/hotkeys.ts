import { useEffect } from 'react'
import { useApp } from './store'

/**
 * Global hotkeys:
 *  - Ctrl/Cmd+K — command palette
 *  - Ctrl/Cmd+R and F5 — refresh cluster (preventDefault keeps the webview
 *    from doing a full reload, which would reset app state)
 */
export function useHotkeys(): void {
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const refresh = useApp((s) => s.refreshCluster)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      } else if ((mod && e.key.toLowerCase() === 'r') || e.key === 'F5') {
        e.preventDefault()
        void refresh()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setPaletteOpen, refresh])
}

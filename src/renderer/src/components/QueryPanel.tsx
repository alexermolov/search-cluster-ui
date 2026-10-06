import { useCallback, useEffect, useState } from 'react'
import { QueryTabView } from './QueryTabView'

interface QueryTabState {
  id: string
  title: string
}

let tabSeq = 0

function newTab(): QueryTabState {
  tabSeq += 1
  return { id: `qtab-${tabSeq}`, title: `Query ${tabSeq}` }
}

/**
 * Query console tab manager: owns the tab strip and keeps every tab
 * mounted (hidden via CSS when inactive) so background tabs keep their
 * state and in-flight requests are not interrupted.
 *
 * Hotkeys: Ctrl+Alt+T — new tab, Ctrl+Alt+W — close the current tab.
 */
export function QueryPanel() {
  const [tabs, setTabs] = useState<QueryTabState[]>(() => [newTab()])
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id)

  const addTab = useCallback(() => {
    const tab = newTab()
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
  }, [])

  const closeTab = useCallback(
    (tabId: string) => {
      // The last tab stays open — its close button is hidden anyway.
      if (tabs.length <= 1) return
      const idx = tabs.findIndex((t) => t.id === tabId)
      if (idx < 0) return
      const next = tabs.filter((t) => t.id !== tabId)
      setTabs(next)
      // Closing the active tab switches to a neighbor.
      if (activeTabId === tabId) {
        setActiveTabId((next[idx] ?? next[idx - 1]).id)
      }
    },
    [tabs, activeTabId],
  )

  // Global hotkeys: Ctrl+Alt+T new tab, Ctrl+Alt+W close current.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if (!(e.ctrlKey && e.altKey)) return
      if (e.code === 'KeyT') {
        e.preventDefault()
        addTab()
      } else if (e.code === 'KeyW') {
        e.preventDefault()
        closeTab(activeTabId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addTab, closeTab, activeTabId])

  /** Title updates from a tab: index pattern after a successful run. */
  const onTitle = useCallback((tabId: string, title: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, title } : t)))
  }, [])

  return (
    <div className="query-console">
      <div className="qtab-bar">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`qtab${t.id === activeTabId ? ' active' : ''}`}
            onClick={() => setActiveTabId(t.id)}
            title={t.title}
          >
            <span className="qtab-title">{t.title}</span>
            {tabs.length > 1 && (
              <button
                className="qtab-close"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button className="btn qtab-add" onClick={addTab} title="New query tab (Ctrl+Alt+T)">
          +
        </button>
      </div>

      {tabs.map((t) => (
        <div key={t.id} className={t.id === activeTabId ? 'qtab-panel' : 'qtab-panel hidden'}>
          <QueryTabView tabId={t.id} onTitle={onTitle} />
        </div>
      ))}
    </div>
  )
}

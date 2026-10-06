import { useEffect, useMemo, useRef, useState } from 'react'
import { AUTO_REFRESH_OPTIONS, useApp, type Tab } from '../store'

interface Command {
  id: string
  label: string
  hint?: string
  run: () => void
}

/**
 * Ctrl+K command palette: fuzzy-ish filter over app actions (tabs, refresh,
 * theme, auto-refresh, connections). Arrow keys + Enter, Esc closes.
 */
export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen)
  const setOpen = useApp((s) => s.setPaletteOpen)
  const setTab = useApp((s) => s.setTab)
  const refresh = useApp((s) => s.refreshCluster)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const setAutoRefreshSec = useApp((s) => s.setAutoRefreshSec)
  const autoRefreshSec = useApp((s) => s.autoRefreshSec)
  const connections = useApp((s) => s.connections)
  const activeId = useApp((s) => s.activeId)
  const selectConnection = useApp((s) => s.selectConnection)
  const openEditor = useApp((s) => s.openEditor)

  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const commands = useMemo<Command[]>(() => {
    const tabs: { id: Tab; label: string }[] = [
      { id: 'overview', label: 'Go to Overview' },
      { id: 'indices', label: 'Go to Indices' },
      { id: 'query', label: 'Go to Query' },
      { id: 'shards', label: 'Go to Shards' },
      { id: 'snapshots', label: 'Go to Snapshots' },
      { id: 'schemas', label: 'Go to Schemas' },
      { id: 'settings', label: 'Go to Settings' },
    ]
    const cmds: Command[] = [
      ...tabs.map((t) => ({
        id: `tab:${t.id}`,
        label: t.label,
        hint: 'Tab',
        run: () => setTab(t.id),
      })),
      { id: 'refresh', label: 'Refresh cluster', hint: 'Ctrl+R / F5', run: () => void refresh() },
      {
        id: 'theme',
        label: 'Toggle dark / light theme',
        hint: 'Theme',
        run: () => toggleTheme(),
      },
      ...AUTO_REFRESH_OPTIONS.map((sec) => ({
        id: `autorefresh:${sec}`,
        label: sec === 0 ? 'Auto-refresh: off' : `Auto-refresh: every ${sec}s`,
        hint: sec === autoRefreshSec ? 'current' : 'Polling',
        run: () => setAutoRefreshSec(sec),
      })),
      { id: 'conn:new', label: 'Add connection…', hint: 'Connection', run: () => openEditor() },
      ...connections.map((c) => ({
        id: `conn:${c.id}`,
        label: `Switch to ${c.name}`,
        hint: c.id === activeId ? 'active' : 'Connection',
        run: () => void selectConnection(c.id),
      })),
    ]
    return cmds
  }, [
    setTab,
    refresh,
    toggleTheme,
    setAutoRefreshSec,
    autoRefreshSec,
    connections,
    activeId,
    selectConnection,
    openEditor,
  ])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => c.label.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      // Focus after the palette mounts.
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    setSelected(0)
  }, [query])

  if (!open) return null

  const runSelected = () => {
    const cmd = filtered[selected]
    if (!cmd) return
    setOpen(false)
    cmd.run()
  }

  return (
    <div
      className="palette-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div className="palette">
        <input
          ref={inputRef}
          className="input palette-input"
          placeholder="Type a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((s) => Math.min(s + 1, filtered.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              runSelected()
            }
          }}
        />
        <div className="palette-list">
          {filtered.map((c, i) => (
            <div
              key={c.id}
              className={`palette-item${i === selected ? ' selected' : ''}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => {
                setOpen(false)
                c.run()
              }}
            >
              <span className="palette-label">{c.label}</span>
              {c.hint && <span className="palette-hint">{c.hint}</span>}
            </div>
          ))}
          {filtered.length === 0 && <div className="palette-empty">No matching commands</div>}
        </div>
        <div className="palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}

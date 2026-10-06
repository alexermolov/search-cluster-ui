import { useState } from 'react'
import type { StoredConnection } from '../../../shared/types'
import { AUTO_REFRESH_OPTIONS, useApp } from '../store'
import { ConfirmDialog } from './ConfirmDialog'

const FLAVOR_TAG = { elasticsearch: 'ES', opensearch: 'OS' } as const

export function Sidebar() {
  const connections = useApp((s) => s.connections)
  const activeId = useApp((s) => s.activeId)
  const overview = useApp((s) => s.overview)
  const select = useApp((s) => s.selectConnection)
  const openEditor = useApp((s) => s.openEditor)
  const remove = useApp((s) => s.removeConnection)
  const autoRefreshSec = useApp((s) => s.autoRefreshSec)
  const setAutoRefreshSec = useApp((s) => s.setAutoRefreshSec)
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const setPaletteOpen = useApp((s) => s.setPaletteOpen)
  const [pendingDelete, setPendingDelete] = useState<StoredConnection | null>(null)

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <span className="logo">◈</span> Cluster UI
        <span className="spacer" />
        <button
          className="icon-btn"
          title="Command palette (Ctrl+K)"
          onClick={() => setPaletteOpen(true)}
        >
          ⌘K
        </button>
        <button
          className="icon-btn"
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          onClick={toggleTheme}
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>

      <div className="sidebar-label">Connections</div>

      <div className="conn-list">
        {connections.map((c) => {
          const isActive = c.id === activeId
          const health = isActive ? (overview?.health.status ?? null) : null
          return (
            <div
              key={c.id}
              className={`conn-item${isActive ? ' active' : ''}`}
              onClick={() => void select(c.id)}
            >
              <span className={`dot dot-${health ?? 'unknown'}`} />
              <div className="conn-meta">
                <div className="conn-name">{c.name}</div>
                <div className="conn-url">{c.url}</div>
              </div>
              <span className="flavor-tag">{FLAVOR_TAG[c.flavor]}</span>
              <div className="conn-actions">
                <button
                  title="Edit"
                  onClick={(e) => {
                    e.stopPropagation()
                    openEditor(c)
                  }}
                >
                  ✎
                </button>
                <button
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPendingDelete(c)
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          )
        })}
        {connections.length === 0 && <div className="conn-empty">No connections yet</div>}
      </div>

      <div className="autorefresh-row">
        <label className="autorefresh-label" htmlFor="autorefresh">
          Auto-refresh
        </label>
        <select
          id="autorefresh"
          className="input autorefresh-select"
          value={autoRefreshSec}
          onChange={(e) => setAutoRefreshSec(Number(e.target.value))}
        >
          {AUTO_REFRESH_OPTIONS.map((sec) => (
            <option key={sec} value={sec}>
              {sec === 0 ? 'Off' : `${sec}s`}
            </option>
          ))}
        </select>
      </div>

      <button className="btn btn-primary btn-block" onClick={() => openEditor()}>
        + Add connection
      </button>
      {pendingDelete && (
        <ConfirmDialog
          title="Delete connection"
          message={
            <>
              Delete connection <span className="mono">{pendingDelete.name}</span> (
              <span className="mono">{pendingDelete.url}</span>)? Stored credentials will be
              removed. This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            const id = pendingDelete.id
            setPendingDelete(null)
            void remove(id)
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </aside>
  )
}

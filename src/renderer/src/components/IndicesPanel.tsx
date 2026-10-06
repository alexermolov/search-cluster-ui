import { useMemo, useState } from 'react'
import type { IndexInfo } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../store'
import { ConfirmDialog } from './ConfirmDialog'
import { ContextMenu, useContextMenu, type ContextMenuItem } from './ContextMenu'
import { ReindexDialog } from './ReindexDialog'
import { fmtStoreSize, parseSize, HealthBadge } from './ui'

type SortKey = 'name' | 'health' | 'status' | 'docs' | 'size' | 'pri' | 'rep'
type SortDir = 'asc' | 'desc'

const HEALTH_RANK: Record<string, number> = { red: 0, yellow: 1, green: 2 }

function compare(a: IndexInfo, b: IndexInfo, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name)
    case 'health': {
      const ra = a.health ? (HEALTH_RANK[a.health] ?? 3) : 3
      const rb = b.health ? (HEALTH_RANK[b.health] ?? 3) : 3
      return ra - rb
    }
    case 'status':
      return a.status.localeCompare(b.status)
    case 'docs':
      return (a.docsCount ?? -1) - (b.docsCount ?? -1)
    case 'size':
      return parseSize(a.storeSize) - parseSize(b.storeSize)
    case 'pri':
      return a.primaryShards - b.primaryShards
    case 'rep':
      return a.replicas - b.replicas
  }
}

const COLUMNS: { key: SortKey | null; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'health', label: 'Health' },
  { key: 'status', label: 'Status' },
  { key: 'docs', label: 'Docs' },
  { key: 'size', label: 'Store' },
  { key: 'pri', label: 'Pri' },
  { key: 'rep', label: 'Rep' },
]

type PendingAction =
  | { kind: 'delete' }
  | { kind: 'open' }
  | { kind: 'close' }

export function IndicesPanel() {
  const indices = useApp((s) => s.indices)
  const filter = useApp((s) => s.filter)
  const setFilter = useApp((s) => s.setFilter)
  const loading = useApp((s) => s.loadingCluster)
  const openIndex = useApp((s) => s.openIndex)
  const activeId = useApp((s) => s.activeId)
  const refreshCluster = useApp((s) => s.refreshCluster)

  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const [pending, setPending] = useState<(PendingAction & { index: IndexInfo }) | null>(null)
  const [reindexFor, setReindexFor] = useState<IndexInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const ctx = useContextMenu<IndexInfo>()

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc') // numeric columns: biggest first
    }
  }

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const filtered = f ? indices.filter((i) => i.name.toLowerCase().includes(f)) : indices
    const sorted = [...filtered].sort((a, b) => compare(a, b, sortKey))
    if (sortDir === 'desc') sorted.reverse()
    return sorted
  }, [indices, filter, sortKey, sortDir])

  async function runAction(action: PendingAction & { index: IndexInfo }): Promise<void> {
    if (!activeId) return
    setBusy(true)
    setActionError(null)
    try {
      if (action.kind === 'delete') {
        await api.deleteIndex(activeId, action.index.name)
      } else if (action.kind === 'open') {
        await api.openIndex(activeId, action.index.name)
      } else {
        await api.closeIndex(activeId, action.index.name)
      }
      setPending(null)
      await refreshCluster()
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function menuItems(index: IndexInfo): ContextMenuItem[] {
    return [
      { label: 'View details', onSelect: () => openIndex(index.name) },
      {
        label: index.status === 'close' ? 'Open index…' : 'Close index…',
        disabled: busy,
        onSelect: () => setPending({ kind: index.status === 'close' ? 'open' : 'close', index }),
      },
      { label: 'Reindex…', disabled: busy, onSelect: () => setReindexFor(index) },
      {
        label: 'Delete index…',
        danger: true,
        disabled: busy,
        onSelect: () => setPending({ kind: 'delete', index }),
      },
    ]
  }

  if (loading && indices.length === 0) return <div className="loading">Loading indices…</div>

  return (
    <div className="indices">
      <div className="toolbar">
        <input
          className="input"
          placeholder="Filter indices…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted">
          {visible.length} of {indices.length}
        </span>
      </div>

      {actionError && <div className="banner banner-error">{actionError}</div>}

      <table className="table table-hover">
        <thead>
          <tr>
            {COLUMNS.map((c) =>
              c.key === null ? (
                <th key={c.label}>{c.label}</th>
              ) : (
                <th
                  key={c.key}
                  className="th-sortable"
                  onClick={() => toggleSort(c.key!)}
                  title="Click to sort"
                >
                  {c.label}
                  {sortKey === c.key && <span className="sort-arrow">{sortDir === 'asc' ? ' ▲' : ' ▼'}</span>}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {visible.map((i) => (
            <IndexRow
              key={i.uuid || i.name}
              index={i}
              onSelect={() => openIndex(i.name)}
              onContextMenu={(e) => ctx.open(e, i)}
            />
          ))}
          {visible.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No indices
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {ctx.menu && (
        <ContextMenu
          x={ctx.menu.x}
          y={ctx.menu.y}
          items={menuItems(ctx.menu.target)}
          onClose={ctx.close}
        />
      )}

      {pending?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete index"
          message={
            <>
              Delete index <span className="mono">{pending.index.name}</span>? This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'open' && (
        <ConfirmDialog
          title="Open index"
          message={
            <>
              Open index <span className="mono">{pending.index.name}</span>? It will become available
              for reads and writes again.
            </>
          }
          confirmLabel="Open"
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'close' && (
        <ConfirmDialog
          title="Close index"
          message={
            <>
              Close index <span className="mono">{pending.index.name}</span>? It will become
              unavailable for reads and writes until opened again.
            </>
          }
          confirmLabel="Close"
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {reindexFor && activeId && (
        <ReindexDialog
          connectionId={activeId}
          sourceIndex={reindexFor.name}
          onClose={() => {
            setReindexFor(null)
            void refreshCluster()
          }}
        />
      )}
    </div>
  )
}

function IndexRow({
  index,
  onSelect,
  onContextMenu,
}: {
  index: IndexInfo
  onSelect: () => void
  onContextMenu: (e: React.MouseEvent) => void
}) {
  return (
    <tr onClick={onSelect} onContextMenu={onContextMenu}>
      <td className="mono">{index.name}</td>
      <td>
        <HealthBadge status={index.health} />
      </td>
      <td className="muted">{index.status}</td>
      <td>{index.docsCount?.toLocaleString() ?? '—'}</td>
      <td>{fmtStoreSize(index)}</td>
      <td>{index.primaryShards}</td>
      <td>{index.replicas}</td>
    </tr>
  )
}

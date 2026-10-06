import { useEffect, useMemo, useRef, useState } from 'react'
import type { SnapshotInfo } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../store'
import { ConfirmDialog } from './ConfirmDialog'
import { ContextMenu, useContextMenu, type ContextMenuItem } from './ContextMenu'
import { SnapshotCreateDialog } from './SnapshotCreateDialog'
import { SnapshotRestoreDialog } from './SnapshotRestoreDialog'

function statusBadgeClass(status: string): string {
  if (status === 'SUCCESS') return 'badge badge-green'
  if (status === 'PARTIAL' || status === 'IN_PROGRESS') return 'badge badge-yellow'
  if (status === 'FAILED') return 'badge badge-red'
  return 'badge badge-unknown'
}

function IndicesCell({ indices }: { indices: string }) {
  const list = indices
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (list.length === 0) return <span className="muted">—</span>
  const shown = list.slice(0, 3).join(', ')
  const rest = list.length - 3
  return (
    <span className="indices-cell" title={list.join(', ')}>
      {shown}
      {rest > 0 && <span className="muted"> +{rest} more</span>}
    </span>
  )
}

export function SnapshotsPanel() {
  const activeId = useApp((s) => s.activeId)
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  const [createOpen, setCreateOpen] = useState(false)
  const [restore, setRestore] = useState<SnapshotInfo | null>(null)
  const [pendingDelete, setPendingDelete] = useState<SnapshotInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const ctx = useContextMenu<SnapshotInfo>()

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSnapshots([])

    api
      .fetchSnapshots(activeId)
      .then((r) => !cancelled && setSnapshots(r))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [activeId, reloadTick])

  // Poll while any snapshot is in progress, so statuses update live.
  const hasInProgress = snapshots.some((s) => s.status === 'IN_PROGRESS')
  const inProgressRef = useRef(hasInProgress)
  inProgressRef.current = hasInProgress
  useEffect(() => {
    if (!hasInProgress) return
    const timer = setInterval(() => {
      if (!activeId || !inProgressRef.current) return
      api
        .fetchSnapshots(activeId)
        .then((r) => setSnapshots(r))
        .catch(() => {}) // silent: polling failures keep the last state
    }, 3000)
    return () => clearInterval(timer)
  }, [hasInProgress, activeId])

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return snapshots
    return snapshots.filter(
      (s) =>
        s.snapshot.toLowerCase().includes(f) ||
        s.repository.toLowerCase().includes(f) ||
        s.indices.toLowerCase().includes(f),
    )
  }, [snapshots, filter])

  async function runDelete(): Promise<void> {
    if (!activeId || !pendingDelete) return
    setBusy(true)
    setActionError(null)
    try {
      await api.deleteSnapshot(activeId, pendingDelete.repository, pendingDelete.snapshot)
      setPendingDelete(null)
      setReloadTick((t) => t + 1)
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function menuItems(s: SnapshotInfo): ContextMenuItem[] {
    const inProgress = s.status === 'IN_PROGRESS'
    return [
      {
        label: 'Restore…',
        disabled: busy || inProgress,
        onSelect: () => setRestore(s),
      },
      {
        label: 'Delete…',
        danger: true,
        disabled: busy || inProgress,
        onSelect: () => setPendingDelete(s),
      },
    ]
  }

  return (
    <div className="snapshots">
      <div className="toolbar">
        <input
          className="input"
          placeholder="Filter by snapshot, repository or indices…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted">
          {visible.length} of {snapshots.length} snapshots
        </span>
        <button className="btn" onClick={() => setReloadTick((t) => t + 1)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button className="btn btn-primary" onClick={() => setCreateOpen(true)}>
          Create snapshot…
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {actionError && <div className="banner banner-error">{actionError}</div>}

      {loading && snapshots.length === 0 && !error && (
        <div className="loading">Loading snapshots…</div>
      )}

      {!loading && snapshots.length === 0 && !error && (
        <div className="muted">No snapshots (or no repositories configured)</div>
      )}

      {snapshots.length > 0 && (
        <table className="table table-hover">
          <thead>
            <tr>
              <th>Snapshot</th>
              <th>Repository</th>
              <th>Status</th>
              <th>Indices</th>
              <th>Started</th>
              <th>Ended</th>
              <th>Duration</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr key={`${s.repository}|${s.snapshot}`} onContextMenu={(e) => ctx.open(e, s)}>
                <td className="mono">{s.snapshot}</td>
                <td className="mono muted">{s.repository}</td>
                <td>
                  <span className={statusBadgeClass(s.status)}>{s.status}</span>
                </td>
                <td>
                  <IndicesCell indices={s.indices} />
                </td>
                <td className="muted">{s.startTime}</td>
                <td className="muted">{s.endTime}</td>
                <td>{s.duration}</td>
                <td>
                  <span className="actions-cell">
                    <button
                      className="btn"
                      title={`Restore snapshot "${s.snapshot}"`}
                      disabled={busy}
                      onClick={() => setRestore(s)}
                    >
                      Restore
                    </button>
                    <button
                      className="btn"
                      title={`Delete snapshot "${s.snapshot}"`}
                      disabled={busy}
                      onClick={() => setPendingDelete(s)}
                    >
                      Delete
                    </button>
                  </span>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="muted">
                  No snapshots
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {ctx.menu && (
        <ContextMenu
          x={ctx.menu.x}
          y={ctx.menu.y}
          items={menuItems(ctx.menu.target)}
          onClose={ctx.close}
        />
      )}

      {createOpen && activeId && (
        <SnapshotCreateDialog
          connectionId={activeId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => setReloadTick((t) => t + 1)}
        />
      )}

      {restore && activeId && (
        <SnapshotRestoreDialog
          connectionId={activeId}
          repository={restore.repository}
          snapshot={restore.snapshot}
          onClose={() => setRestore(null)}
          onRestored={() => setReloadTick((t) => t + 1)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete snapshot"
          message={
            <>
              Delete snapshot <span className="mono">{pendingDelete.snapshot}</span> from repository{' '}
              <span className="mono">{pendingDelete.repository}</span>? This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => void runDelete()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import type { ShardInfo } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../store'
import { AllocationExplainDialog } from './AllocationExplainDialog'
import { ContextMenu, useContextMenu, type ContextMenuItem } from './ContextMenu'
import { RerouteDialog } from './RerouteDialog'

function stateBadgeClass(state: string): string {
  if (state === 'STARTED') return 'badge badge-green'
  if (state === 'UNASSIGNED') return 'badge badge-red'
  if (state === 'RELOCATING' || state === 'INITIALIZING') return 'badge badge-yellow'
  return 'badge badge-unknown'
}

export function ShardsPanel() {
  const activeId = useApp((s) => s.activeId)
  const [shards, setShards] = useState<ShardInfo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [reloadTick, setReloadTick] = useState(0)

  const [explainTarget, setExplainTarget] = useState<
    { index: string; shard: string; primary: boolean } | null | undefined
  >(undefined)
  const [rerouteOpen, setRerouteOpen] = useState(false)

  const ctx = useContextMenu<ShardInfo>()

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setShards([])

    api
      .fetchShards(activeId)
      .then((r) => !cancelled && setShards(r))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [activeId, reloadTick])

  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    if (!f) return shards
    return shards.filter(
      (s) => s.index.toLowerCase().includes(f) || s.node.toLowerCase().includes(f),
    )
  }, [shards, filter])

  const summary = useMemo(() => {
    let primaries = 0
    let replicas = 0
    let unassigned = 0
    for (const s of shards) {
      if (s.type === 'p') primaries++
      else replicas++
      if (s.state === 'UNASSIGNED') unassigned++
    }
    return { total: shards.length, primaries, replicas, unassigned }
  }, [shards])

  function menuItems(s: ShardInfo): ContextMenuItem[] {
    return [
      {
        label: 'Explain allocation…',
        disabled: s.state !== 'UNASSIGNED',
        onSelect: () =>
          setExplainTarget({
            index: s.index,
            shard: s.shard,
            primary: s.type === 'p',
          }),
      },
      { label: 'Reroute…', onSelect: () => setRerouteOpen(true) },
    ]
  }

  return (
    <div className="shards">
      <div className="cards">
        <div className="card">
          <div className="card-label">Total shards</div>
          <div className="card-value">{summary.total.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="card-label">Primaries</div>
          <div className="card-value">{summary.primaries.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="card-label">Replicas</div>
          <div className="card-value">{summary.replicas.toLocaleString()}</div>
        </div>
        <div className="card">
          <div className="card-label">Unassigned</div>
          <div className="card-value">{summary.unassigned.toLocaleString()}</div>
        </div>
      </div>

      <div className="toolbar">
        <input
          className="input"
          placeholder="Filter by index or node…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <span className="muted">
          {visible.length} of {shards.length} shards
        </span>
        <button className="btn" onClick={() => setReloadTick((t) => t + 1)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
        <button
          className="btn"
          title="Explain why the first unassigned shard cannot be allocated"
          onClick={() => setExplainTarget(null)}
        >
          Explain unassigned…
        </button>
        <button className="btn" onClick={() => setRerouteOpen(true)}>
          Reroute…
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      {loading && shards.length === 0 && !error && <div className="loading">Loading shards…</div>}

      {!loading && shards.length === 0 && !error && <div className="muted">No shards</div>}

      {shards.length > 0 && (
        <table className="table table-hover">
          <thead>
            <tr>
              <th>Index</th>
              <th>Shard</th>
              <th>Type</th>
              <th>State</th>
              <th>Docs</th>
              <th>Store</th>
              <th>IP</th>
              <th>Node</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((s) => (
              <tr
                key={`${s.index}|${s.shard}|${s.type}|${s.node}`}
                onContextMenu={(e) => ctx.open(e, s)}
              >
                <td className="mono">{s.index}</td>
                <td>{s.shard}</td>
                <td>
                  <span className={`shard-type shard-type-${s.type}`}>
                    {s.type === 'p' ? 'primary' : 'replica'}
                  </span>
                </td>
                <td>
                  <span className={stateBadgeClass(s.state)}>{s.state}</span>
                </td>
                <td>{s.docs?.toLocaleString() ?? '—'}</td>
                <td>{s.store}</td>
                <td className="mono muted">{s.ip}</td>
                <td>{s.node}</td>
                <td>
                  {s.state === 'UNASSIGNED' && (
                    <button
                      className="btn"
                      title={`Explain why shard ${s.shard} of ${s.index} is unassigned`}
                      onClick={() =>
                        setExplainTarget({
                          index: s.index,
                          shard: s.shard,
                          primary: s.type === 'p',
                        })
                      }
                    >
                      Explain
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="muted">
                  No shards
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

      {explainTarget !== undefined && activeId && (
        <AllocationExplainDialog
          connectionId={activeId}
          target={explainTarget}
          onClose={() => setExplainTarget(undefined)}
        />
      )}

      {rerouteOpen && activeId && (
        <RerouteDialog
          connectionId={activeId}
          onClose={() => setRerouteOpen(false)}
          onRerouted={() => setReloadTick((t) => t + 1)}
        />
      )}
    </div>
  )
}

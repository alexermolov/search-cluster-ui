import { useApp } from '../store'
import { fmtPct, HealthBadge } from './ui'

export function OverviewPanel() {
  const overview = useApp((s) => s.overview)
  const loading = useApp((s) => s.loadingCluster)
  const overviewUpdatedAt = useApp((s) => s.overviewUpdatedAt)
  const autoRefreshSec = useApp((s) => s.autoRefreshSec)

  if (loading && !overview) return <div className="loading">Loading cluster…</div>
  if (!overview) return null

  const { info, health, nodes } = overview

  return (
    <div className="overview">
      {overviewUpdatedAt !== null && (
        <div className="overview-meta">
          Updated {new Date(overviewUpdatedAt).toLocaleTimeString()}
          {autoRefreshSec > 0 && ` · auto-refresh ${autoRefreshSec}s`}
        </div>
      )}
      <div className="cards">
        <div className="card">
          <div className="card-label">Status</div>
          <div className="card-value">
            <HealthBadge status={health.status} />
          </div>
          {health.timedOut && <div className="card-sub">health request timed out</div>}
        </div>
        <div className="card">
          <div className="card-label">Nodes</div>
          <div className="card-value">{health.numberOfNodes}</div>
          <div className="card-sub">{health.numberOfDataNodes} data nodes</div>
        </div>
        <div className="card">
          <div className="card-label">Active shards</div>
          <div className="card-value">{health.activeShards.toLocaleString()}</div>
          <div className="card-sub">
            {health.relocatingShards} relocating · {health.initializingShards} initializing
          </div>
        </div>
        <div className={health.unassignedShards > 0 ? 'card card-warn' : 'card'}>
          <div className="card-label">Unassigned shards</div>
          <div
            className={health.unassignedShards > 0 ? 'card-value card-value-warn' : 'card-value'}
          >
            {health.unassignedShards.toLocaleString()}
          </div>
          <div className="card-sub">
            {health.delayedUnassignedShards > 0
              ? `⚠ ${health.delayedUnassignedShards} delayed (allocation timeout)`
              : `${health.delayedUnassignedShards} delayed`}
          </div>
        </div>
        <div className={health.pendingTasks > 0 ? 'card card-warn' : 'card'}>
          <div className="card-label">Pending tasks</div>
          <div
            className={health.pendingTasks > 0 ? 'card-value card-value-warn' : 'card-value'}
          >
            {health.pendingTasks}
          </div>
          <div className="card-sub">
            {health.pendingTasks > 0 ? 'cluster is processing tasks' : 'none'}
          </div>
        </div>
        <div className="card">
          <div className="card-label">Version</div>
          <div className="card-value">{info.version}</div>
          <div className="card-sub">{info.distribution}</div>
        </div>
      </div>

      <h2 className="section-title">Nodes ({nodes.length})</h2>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Version</th>
            <th>IP</th>
            <th>Roles</th>
            <th>Heap</th>
            <th>RAM</th>
            <th>Disk</th>
          </tr>
        </thead>
        <tbody>
          {nodes.map((n) => (
            <tr key={n.name}>
              <td>{n.name}</td>
              <td className="muted">{n.version}</td>
              <td className="mono muted">{n.ip}</td>
              <td>
                {n.roles.map((r) => (
                  <span key={r} className="chip">
                    {r}
                  </span>
                ))}
              </td>
              <td>{fmtPct(n.heapPercent)}</td>
              <td>{fmtPct(n.ramPercent)}</td>
              <td>{fmtPct(n.diskPercent)}</td>
            </tr>
          ))}
          {nodes.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No nodes reported
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

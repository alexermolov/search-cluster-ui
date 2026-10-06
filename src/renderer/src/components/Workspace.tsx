import { useApp, type Tab } from '../store'
import { ClusterSettingsPanel } from './ClusterSettingsPanel'
import { IndexDetailView } from './IndexDetail'
import { IndicesPanel } from './IndicesPanel'
import { OverviewPanel } from './OverviewPanel'
import { QueryPanel } from './QueryPanel'
import { ShardsPanel } from './ShardsPanel'
import { SchemasPanel } from './SchemasPanel'
import { SnapshotsPanel } from './SnapshotsPanel'
import { HealthBadge } from './ui'

const TABS: Tab[] = ['overview', 'indices', 'query', 'shards', 'snapshots', 'schemas', 'settings']

export function Workspace() {
  const active = useApp((s) => s.connections.find((c) => c.id === s.activeId) ?? null)
  const overview = useApp((s) => s.overview)
  const tab = useApp((s) => s.tab)
  const setTab = useApp((s) => s.setTab)
  const refresh = useApp((s) => s.refreshCluster)
  const loading = useApp((s) => s.loadingCluster)
  const error = useApp((s) => s.error)
  const openEditor = useApp((s) => s.openEditor)
  const selectedIndex = useApp((s) => s.selectedIndex)
  const closeIndex = useApp((s) => s.closeIndex)

  if (!active) {
    return (
      <main className="workspace empty">
        <div className="empty-state">
          <div className="empty-title">No cluster selected</div>
          <div>Add a connection to an Elasticsearch or OpenSearch cluster.</div>
          <button className="btn btn-primary" onClick={() => openEditor()}>
            + Add connection
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="workspace">
      <header className="ws-header">
        <div className="ws-header-title">
          <h1 className="ws-title">{overview?.info.clusterName ?? active.name}</h1>
          <div className="ws-sub">
            {overview
              ? `${overview.info.distribution} ${overview.info.version} · ${active.url}`
              : active.url}
          </div>
        </div>
        <div className="ws-actions">
          <HealthBadge status={overview?.health.status ?? null} />
          <button className="btn" onClick={() => void refresh()} disabled={loading}>
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {error && <div className="banner banner-error">{error}</div>}

      {selectedIndex !== null ? (
        <div className="ws-body">
          <IndexDetailView indexName={selectedIndex} onBack={closeIndex} />
        </div>
      ) : (
        <>
          <nav className="tabbar">
            {TABS.map((t) => (
              <button
                key={t}
                className={`tab${tab === t ? ' active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>

          <div className="ws-body">
            {/* QueryPanel stays mounted (hidden via CSS) so query tabs keep
                their state and in-flight requests when switching tabs. */}
            <div className={tab === 'query' ? '' : 'hidden'}>
              <QueryPanel />
            </div>
            {tab === 'overview' && <OverviewPanel />}
            {tab === 'indices' && <IndicesPanel />}
            {tab === 'shards' && <ShardsPanel />}
            {tab === 'snapshots' && <SnapshotsPanel />}
            {tab === 'schemas' && <SchemasPanel />}
            {tab === 'settings' && <ClusterSettingsPanel />}
          </div>
        </>
      )}
    </main>
  )
}

import { useApp, type Tab } from "../store";
import { useHotkeys } from "../hotkeys";
import { ClusterSettingsPanel } from "./ClusterSettingsPanel";
import { IndexDetailView } from "./IndexDetail";
import { IndicesPanel } from "./IndicesPanel";
import { OverviewPanel } from "./OverviewPanel";
import { QueryPanel } from "./QueryPanel";
import { ShardsPanel } from "./ShardsPanel";
import { SchemasPanel } from "./SchemasPanel";
import { SnapshotsPanel } from "./SnapshotsPanel";
import { HealthBadge } from "./ui";

const TABS: Tab[] = [
  "overview",
  "indices",
  "query",
  "shards",
  "snapshots",
  "schemas",
  "settings",
];

export function Workspace() {
  useHotkeys();
  const active = useApp(
    (s) => s.connections.find((c) => c.id === s.activeId) ?? null,
  );
  const overview = useApp((s) => s.overview);
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const refresh = useApp((s) => s.refreshCluster);
  const loading = useApp((s) => s.loadingCluster);
  const error = useApp((s) => s.error);
  const openEditor = useApp((s) => s.openEditor);
  const selectedIndex = useApp((s) => s.selectedIndex);
  const closeIndex = useApp((s) => s.closeIndex);

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
    );
  }

  return (
    <main className="workspace">
      <header className="ws-header">
        <div className="ws-header-title">
          <h1 className="ws-title">
            {overview?.info.clusterName ?? active.name}
          </h1>
          <div className="ws-sub">
            {overview
              ? `${overview.info.distribution} ${overview.info.version} · ${active.url}`
              : active.url}
          </div>
        </div>
        <div className="ws-actions">
          <HealthBadge status={overview?.health.status ?? null} />
          <button
            className="btn"
            onClick={() => void refresh()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && <div className="banner banner-error">{error}</div>}

      {selectedIndex === null && (
        <>
          <nav className="tabbar">
            {TABS.map((t) => (
              <button
                key={t}
                className={`tab${tab === t ? " active" : ""}`}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </nav>
        </>
      )}

      <div className="ws-body">
        {/* Keep query tabs mounted while navigating to index details or other tabs. */}
        <div
          className={
            selectedIndex === null && tab === "query" ? "" : "hidden"
          }
        >
          <QueryPanel />
        </div>
        {selectedIndex !== null ? (
          <IndexDetailView indexName={selectedIndex} onBack={closeIndex} />
        ) : (
          <>
            {tab === "overview" && <OverviewPanel />}
            {tab === "indices" && <IndicesPanel />}
            {tab === "shards" && <ShardsPanel />}
            {tab === "snapshots" && <SnapshotsPanel />}
            {tab === "schemas" && <SchemasPanel />}
            {tab === "settings" && <ClusterSettingsPanel />}
          </>
        )}
      </div>
    </main>
  );
}

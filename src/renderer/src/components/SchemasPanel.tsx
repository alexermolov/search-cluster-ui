import { useEffect, useMemo, useState } from 'react'
import type {
  ComponentTemplateInfo,
  DataStreamInfo,
  IlmIndexStatus,
  IlmPolicyInfo,
  IndexTemplateInfo,
} from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../store'
import { ConfirmDialog } from './ConfirmDialog'
import { ContextMenu, useContextMenu, type ContextMenuItem } from './ContextMenu'
import { CreateIndexFromTemplateDialog } from './CreateIndexFromTemplateDialog'
import { JsonEditor } from './JsonEditor'
import { JsonView } from './JsonView'

type SubTab = 'index-templates' | 'component-templates' | 'lifecycle' | 'data-streams'

const SUBTABS: { id: SubTab; label: string }[] = [
  { id: 'index-templates', label: 'Index Templates' },
  { id: 'component-templates', label: 'Component Templates' },
  { id: 'lifecycle', label: 'Lifecycle Policies' },
  { id: 'data-streams', label: 'Data Streams' },
]

/** Empty body for a new composable index template. */
const NEW_INDEX_TEMPLATE_BODY = '{\n  "index_patterns": [],\n  "template": {}\n}'
/** Empty body for a new component template. */
const NEW_COMPONENT_TEMPLATE_BODY = '{\n  "template": {}\n}'

function parseBody(text: string): Record<string, unknown> | 'invalid' {
  try {
    const v: unknown = JSON.parse(text.trim() === '' ? '{}' : text)
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return 'invalid'
    return v as Record<string, unknown>
  } catch {
    return 'invalid'
  }
}

/** Group lifecycle statuses by phase, keeping a stable phase order. */
function groupByPhase(statuses: IlmIndexStatus[]): [string, IlmIndexStatus[]][] {
  const groups = new Map<string, IlmIndexStatus[]>()
  for (const s of statuses) {
    const phase = s.phase ?? 'unknown'
    const list = groups.get(phase)
    if (list) list.push(s)
    else groups.set(phase, [s])
  }
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
}

/**
 * Schema management: index templates, component templates, lifecycle
 * policies (ILM/ISM) and data streams. Local sub-tabs; data is loaded per
 * sub-tab when the active connection changes.
 */
export function SchemasPanel() {
  const activeId = useApp((s) => s.activeId)
  const [subtab, setSubtab] = useState<SubTab>('index-templates')

  // ---- shared list state ----
  const [indexTemplates, setIndexTemplates] = useState<IndexTemplateInfo[]>([])
  const [componentTemplates, setComponentTemplates] = useState<ComponentTemplateInfo[]>([])
  const [policies, setPolicies] = useState<IlmPolicyInfo[]>([])
  const [ilmStatuses, setIlmStatuses] = useState<IlmIndexStatus[]>([])
  const [dataStreams, setDataStreams] = useState<DataStreamInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // ---- selection / editing state ----
  const [selectedTemplate, setSelectedTemplate] = useState<IndexTemplateInfo | null>(null)
  const [selectedComponent, setSelectedComponent] = useState<ComponentTemplateInfo | null>(null)
  const [selectedPolicy, setSelectedPolicy] = useState<IlmPolicyInfo | null>(null)
  const [expandedStream, setExpandedStream] = useState<string | null>(null)

  // Editing: null = not editing; otherwise the JSON text being edited.
  const [editingTemplate, setEditingTemplate] = useState<{ name: string; text: string } | null>(null)
  const [editingComponent, setEditingComponent] = useState<{ name: string; text: string } | null>(null)

  const [pendingDelete, setPendingDelete] = useState<
    { kind: 'index-template' | 'component-template'; name: string } | null
  >(null)
  const [createIndexFor, setCreateIndexFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // ---- right-click menus ----
  const ctxTemplate = useContextMenu<IndexTemplateInfo>()
  const ctxComponent = useContextMenu<ComponentTemplateInfo>()

  // Reset selection when the connection or sub-tab changes.
  useEffect(() => {
    setSelectedTemplate(null)
    setSelectedComponent(null)
    setSelectedPolicy(null)
    setExpandedStream(null)
    setEditingTemplate(null)
    setEditingComponent(null)
    setActionError(null)
  }, [activeId, subtab])

  // Load the data of the active sub-tab.
  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    setLoading(true)
    setError(null)

    const load = async (): Promise<void> => {
      switch (subtab) {
        case 'index-templates':
          setIndexTemplates(await api.indexTemplates(activeId))
          break
        case 'component-templates':
          setComponentTemplates(await api.componentTemplates(activeId))
          break
        case 'lifecycle': {
          const [p, s] = await Promise.all([api.ilmPolicies(activeId), api.ilmExplain(activeId)])
          setPolicies(p)
          setIlmStatuses(s)
          break
        }
        case 'data-streams':
          setDataStreams(await api.dataStreams(activeId))
          break
      }
    }

    load()
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [activeId, subtab, reloadTick])

  async function saveTemplate(): Promise<void> {
    if (!activeId || !editingTemplate) return
    const body = parseBody(editingTemplate.text)
    if (body === 'invalid') {
      setActionError('Template body is not valid JSON (must be an object)')
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await api.saveIndexTemplate(activeId, editingTemplate.name, body)
      setEditingTemplate(null)
      setSelectedTemplate({ ...selectedTemplate, name: editingTemplate.name, body } as IndexTemplateInfo)
      setReloadTick((t) => t + 1)
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveComponent(): Promise<void> {
    if (!activeId || !editingComponent) return
    const body = parseBody(editingComponent.text)
    if (body === 'invalid') {
      setActionError('Component body is not valid JSON (must be an object)')
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await api.saveComponentTemplate(activeId, editingComponent.name, body)
      setEditingComponent(null)
      setSelectedComponent({ ...selectedComponent, name: editingComponent.name, body } as ComponentTemplateInfo)
      setReloadTick((t) => t + 1)
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function runDelete(): Promise<void> {
    if (!activeId || !pendingDelete) return
    setBusy(true)
    setActionError(null)
    try {
      if (pendingDelete.kind === 'index-template') {
        await api.deleteIndexTemplate(activeId, pendingDelete.name)
        setSelectedTemplate(null)
      } else {
        await api.deleteComponentTemplate(activeId, pendingDelete.name)
        setSelectedComponent(null)
      }
      setPendingDelete(null)
      setReloadTick((t) => t + 1)
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function templateMenuItems(t: IndexTemplateInfo): ContextMenuItem[] {
    return [
      {
        label: 'View details',
        onSelect: () => {
          setEditingTemplate(null)
          setSelectedTemplate(t)
        },
      },
      {
        label: 'Edit…',
        onSelect: () => {
          setSelectedTemplate(t)
          setEditingTemplate({ name: t.name, text: JSON.stringify(t.body, null, 2) })
        },
      },
      {
        label: 'Create index from template…',
        disabled: busy,
        onSelect: () => setCreateIndexFor(t.name),
      },
      {
        label: 'Delete…',
        danger: true,
        disabled: busy,
        onSelect: () => setPendingDelete({ kind: 'index-template', name: t.name }),
      },
    ]
  }

  function componentMenuItems(c: ComponentTemplateInfo): ContextMenuItem[] {
    return [
      {
        label: 'View details',
        onSelect: () => {
          setEditingComponent(null)
          setSelectedComponent(c)
        },
      },
      {
        label: 'Edit…',
        onSelect: () => {
          setSelectedComponent(c)
          setEditingComponent({ name: c.name, text: JSON.stringify(c.body, null, 2) })
        },
      },
      {
        label: 'Delete…',
        danger: true,
        disabled: busy,
        onSelect: () => setPendingDelete({ kind: 'component-template', name: c.name }),
      },
    ]
  }

  const phaseGroups = useMemo(() => groupByPhase(ilmStatuses), [ilmStatuses])

  return (
    <div className="schemas-panel">
      <nav className="subtabbar">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            className={`subtab${subtab === t.id ? ' active' : ''}`}
            onClick={() => setSubtab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && <div className="banner banner-error">{error}</div>}
      {actionError && <div className="banner banner-error">{actionError}</div>}

      {subtab === 'index-templates' && (
        <>
          <div className="toolbar">
            <span className="muted">
              {indexTemplates.length} index template{indexTemplates.length === 1 ? '' : 's'}
            </span>
            <span className="spacer" />
            <button className="btn" onClick={() => setReloadTick((t) => t + 1)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setSelectedTemplate(null)
                setEditingTemplate({ name: '', text: NEW_INDEX_TEMPLATE_BODY })
              }}
            >
              + New template
            </button>
          </div>

          {loading && indexTemplates.length === 0 && !error && (
            <div className="loading">Loading index templates…</div>
          )}
          {!loading && indexTemplates.length === 0 && !error && !editingTemplate && (
            <div className="muted">No index templates</div>
          )}

          {indexTemplates.length > 0 && (
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Index patterns</th>
                  <th>Priority</th>
                  <th>Order</th>
                  <th>Composed of</th>
                  <th>Data stream</th>
                </tr>
              </thead>
              <tbody>
                {indexTemplates.map((t) => (
                  <tr
                    key={t.name}
                    className={selectedTemplate?.name === t.name ? 'row-selected' : ''}
                    onClick={() => {
                      setEditingTemplate(null)
                      setSelectedTemplate(selectedTemplate?.name === t.name ? null : t)
                    }}
                    onContextMenu={(e) => ctxTemplate.open(e, t)}
                  >
                    <td className="mono">{t.name}</td>
                    <td>
                      {t.indexPatterns.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        t.indexPatterns.map((p) => (
                          <span key={p} className="chip">
                            {p}
                          </span>
                        ))
                      )}
                    </td>
                    <td>{t.priority ?? <span className="muted">—</span>}</td>
                    <td>{t.order ?? <span className="muted">—</span>}</td>
                    <td>
                      {t.composedOf.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        t.composedOf.map((c) => (
                          <span key={c} className="chip">
                            {c}
                          </span>
                        ))
                      )}
                    </td>
                    <td>{t.dataStream ? '✓' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {editingTemplate && (
            <div className="schemas-editor">
              <div className="field">
                <span>Template name</span>
                <input
                  className="input mono"
                  autoFocus
                  placeholder="e.g. logs-template"
                  value={editingTemplate.name}
                  onChange={(e) => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                />
              </div>
              <div className="field">
                <span>Template body (PUT /_index_template/&#123;name&#125;)</span>
                <JsonEditor
                  value={editingTemplate.text}
                  onChange={(text) => setEditingTemplate({ ...editingTemplate, text })}
                  minHeight="220px"
                />
              </div>
              <div className="settings-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => void saveTemplate()}
                  disabled={busy || editingTemplate.name.trim() === ''}
                >
                  {busy ? 'Saving…' : 'Save template'}
                </button>
                <button className="btn" onClick={() => setEditingTemplate(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {selectedTemplate && !editingTemplate && (
            <div className="schemas-detail">
              <div className="toolbar">
                <span className="settings-section-heading">Template "{selectedTemplate.name}"</span>
                <span className="spacer" />
                <button
                  className="btn"
                  onClick={() =>
                    setEditingTemplate({
                      name: selectedTemplate.name,
                      text: JSON.stringify(selectedTemplate.body, null, 2),
                    })
                  }
                >
                  Edit
                </button>
                <button
                  className="btn"
                  onClick={() => setCreateIndexFor(selectedTemplate.name)}
                  disabled={busy}
                >
                  Create index from template…
                </button>
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() =>
                    setPendingDelete({ kind: 'index-template', name: selectedTemplate.name })
                  }
                >
                  Delete
                </button>
              </div>
              <pre className="json">
                <JsonView value={selectedTemplate.body} />
              </pre>
            </div>
          )}
        </>
      )}

      {subtab === 'component-templates' && (
        <>
          <div className="toolbar">
            <span className="muted">
              {componentTemplates.length} component template
              {componentTemplates.length === 1 ? '' : 's'}
            </span>
            <span className="spacer" />
            <button className="btn" onClick={() => setReloadTick((t) => t + 1)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setSelectedComponent(null)
                setEditingComponent({ name: '', text: NEW_COMPONENT_TEMPLATE_BODY })
              }}
            >
              + New component
            </button>
          </div>

          {loading && componentTemplates.length === 0 && !error && (
            <div className="loading">Loading component templates…</div>
          )}
          {!loading && componentTemplates.length === 0 && !error && !editingComponent && (
            <div className="muted">No component templates</div>
          )}

          {componentTemplates.length > 0 && (
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Name</th>
                </tr>
              </thead>
              <tbody>
                {componentTemplates.map((c) => (
                  <tr
                    key={c.name}
                    className={selectedComponent?.name === c.name ? 'row-selected' : ''}
                    onClick={() => {
                      setEditingComponent(null)
                      setSelectedComponent(selectedComponent?.name === c.name ? null : c)
                    }}
                    onContextMenu={(e) => ctxComponent.open(e, c)}
                  >
                    <td className="mono">{c.name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {editingComponent && (
            <div className="schemas-editor">
              <div className="field">
                <span>Component name</span>
                <input
                  className="input mono"
                  autoFocus
                  placeholder="e.g. logs-settings"
                  value={editingComponent.name}
                  onChange={(e) => setEditingComponent({ ...editingComponent, name: e.target.value })}
                />
              </div>
              <div className="field">
                <span>Component body (PUT /_component_template/&#123;name&#125;)</span>
                <JsonEditor
                  value={editingComponent.text}
                  onChange={(text) => setEditingComponent({ ...editingComponent, text })}
                  minHeight="220px"
                />
              </div>
              <div className="settings-actions">
                <button
                  className="btn btn-primary"
                  onClick={() => void saveComponent()}
                  disabled={busy || editingComponent.name.trim() === ''}
                >
                  {busy ? 'Saving…' : 'Save component'}
                </button>
                <button className="btn" onClick={() => setEditingComponent(null)} disabled={busy}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {selectedComponent && !editingComponent && (
            <div className="schemas-detail">
              <div className="toolbar">
                <span className="settings-section-heading">Component "{selectedComponent.name}"</span>
                <span className="spacer" />
                <button
                  className="btn"
                  onClick={() =>
                    setEditingComponent({
                      name: selectedComponent.name,
                      text: JSON.stringify(selectedComponent.body, null, 2),
                    })
                  }
                >
                  Edit
                </button>
                <button
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() =>
                    setPendingDelete({ kind: 'component-template', name: selectedComponent.name })
                  }
                >
                  Delete
                </button>
              </div>
              <pre className="json">
                <JsonView value={selectedComponent.body} />
              </pre>
            </div>
          )}
        </>
      )}

      {subtab === 'lifecycle' && (
        <>
          <div className="toolbar">
            <span className="muted">
              {policies.length} polic{policies.length === 1 ? 'y' : 'ies'} · {ilmStatuses.length} managed
              index{ilmStatuses.length === 1 ? '' : 'es'}
            </span>
            <span className="spacer" />
            <button className="btn" onClick={() => setReloadTick((t) => t + 1)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {loading && policies.length === 0 && !error && (
            <div className="loading">Loading lifecycle policies…</div>
          )}
          {!loading && policies.length === 0 && !error && (
            <div className="muted">No lifecycle policies</div>
          )}

          {policies.length > 0 && (
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Policy</th>
                  <th>Phases</th>
                </tr>
              </thead>
              <tbody>
                {policies.map((p) => (
                  <tr
                    key={p.name}
                    className={selectedPolicy?.name === p.name ? 'row-selected' : ''}
                    onClick={() => setSelectedPolicy(selectedPolicy?.name === p.name ? null : p)}
                  >
                    <td className="mono">{p.name}</td>
                    <td>
                      {p.phases.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        p.phases.map((ph) => (
                          <span key={ph} className="chip phase-chip">
                            {ph}
                          </span>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {selectedPolicy && (
            <div className="schemas-detail">
              <div className="settings-section-heading">Policy "{selectedPolicy.name}"</div>
              <pre className="json">
                <JsonView value={selectedPolicy.body} />
              </pre>
            </div>
          )}

          <div className="section-title">Indices by phase</div>
          {ilmStatuses.length === 0 && !loading && (
            <div className="muted">No indices with a lifecycle policy attached</div>
          )}
          {phaseGroups.map(([phase, rows]) => (
            <div key={phase} className="phase-group">
              <div className="phase-group-heading">
                <span className="chip phase-chip">{phase}</span>
                <span className="muted">
                  {rows.length} index{rows.length === 1 ? '' : 'es'}
                </span>
              </div>
              <table className="table">
                <thead>
                  <tr>
                    <th>Index</th>
                    <th>Policy</th>
                    <th>Action</th>
                    <th>Step</th>
                    <th>Age</th>
                    <th>Failed step</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.index}>
                      <td className="mono">{r.index}</td>
                      <td className="mono muted">{r.policy ?? '—'}</td>
                      <td>{r.action ?? <span className="muted">—</span>}</td>
                      <td>{r.step ?? <span className="muted">—</span>}</td>
                      <td className="muted">{r.age ?? '—'}</td>
                      <td>
                        {r.failedStep ? (
                          <span className="failed-step">{r.failedStep}</span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}

      {subtab === 'data-streams' && (
        <>
          <div className="toolbar">
            <span className="muted">
              {dataStreams.length} data stream{dataStreams.length === 1 ? '' : 's'}
            </span>
            <span className="spacer" />
            <button className="btn" onClick={() => setReloadTick((t) => t + 1)} disabled={loading}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {loading && dataStreams.length === 0 && !error && (
            <div className="loading">Loading data streams…</div>
          )}
          {!loading && dataStreams.length === 0 && !error && (
            <div className="muted">No data streams (or not supported by this cluster)</div>
          )}

          {dataStreams.length > 0 && (
            <table className="table table-hover">
              <thead>
                <tr>
                  <th>Data stream</th>
                  <th>Generation</th>
                  <th>Status</th>
                  <th>Timestamp field</th>
                  <th>Backing indices</th>
                </tr>
              </thead>
              <tbody>
                {dataStreams.map((ds) => (
                  <tr
                    key={ds.name}
                    className={expandedStream === ds.name ? 'row-selected' : ''}
                    onClick={() => setExpandedStream(expandedStream === ds.name ? null : ds.name)}
                  >
                    <td className="mono">{ds.name}</td>
                    <td>{ds.generation ?? <span className="muted">—</span>}</td>
                    <td>{ds.status ?? <span className="muted">—</span>}</td>
                    <td className="mono muted">{ds.timestampField ?? '—'}</td>
                    <td>{ds.indices.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {expandedStream &&
            (() => {
              const ds = dataStreams.find((d) => d.name === expandedStream)
              if (!ds) return null
              return (
                <div className="ds-backing">
                  <div className="settings-section-heading">
                    Backing indices of "{ds.name}"
                  </div>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Index</th>
                        <th>Generation</th>
                        <th>Write</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ds.indices.map((i) => (
                        <tr key={i.indexName}>
                          <td className="mono">{i.indexName}</td>
                          <td>{i.generation ?? <span className="muted">—</span>}</td>
                          <td>{i.writeIndex ? <span className="badge badge-green">write</span> : ''}</td>
                          <td>{i.status ?? <span className="muted">—</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            })()}
        </>
      )}

      {ctxTemplate.menu && (
        <ContextMenu
          x={ctxTemplate.menu.x}
          y={ctxTemplate.menu.y}
          items={templateMenuItems(ctxTemplate.menu.target)}
          onClose={ctxTemplate.close}
        />
      )}

      {ctxComponent.menu && (
        <ContextMenu
          x={ctxComponent.menu.x}
          y={ctxComponent.menu.y}
          items={componentMenuItems(ctxComponent.menu.target)}
          onClose={ctxComponent.close}
        />
      )}

      {createIndexFor && activeId && (
        <CreateIndexFromTemplateDialog
          connectionId={activeId}
          templateName={createIndexFor}
          onClose={() => setCreateIndexFor(null)}
          onCreated={() => void useApp.getState().refreshCluster()}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={
            pendingDelete.kind === 'index-template' ? 'Delete index template' : 'Delete component template'
          }
          message={
            <>
              Delete{' '}
              {pendingDelete.kind === 'index-template' ? 'index template' : 'component template'}{' '}
              <span className="mono">{pendingDelete.name}</span>? This cannot be undone.
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

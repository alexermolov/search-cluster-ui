import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { IndexDetail, SearchResults } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../store'
import { BulkDialog } from './BulkDialog'
import { ConfirmDialog } from './ConfirmDialog'
import { DocumentDialog } from './DocumentDialog'
import { JsonView } from './JsonView'
import { ReindexDialog } from './ReindexDialog'

interface Props {
  indexName: string
  onBack: () => void
}

interface SectionProps {
  title: string
  defaultOpen?: boolean
  children: ReactNode
}

type PendingAction =
  | { kind: 'delete' }
  | { kind: 'delete-doc'; docId: string }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'remove-alias'; alias: string }

/** Collapsible section with a rotating chevron, styled like the doc blocks. */
function Section({ title, defaultOpen = false, children }: SectionProps) {
  return (
    <details className="section" open={defaultOpen}>
      <summary className="section-title">{title}</summary>
      {children}
    </details>
  )
}

/** Fullscreen index view: aliases, sample documents, mappings, settings + management actions. */
export function IndexDetailView({ indexName, onBack }: Props) {
  const activeId = useApp((s) => s.activeId)
  const indices = useApp((s) => s.indices)
  const refreshCluster = useApp((s) => s.refreshCluster)
  const reloadTick = useApp((s) => s.indexReloadTick)
  const reloadIndexDetail = useApp((s) => s.reloadIndexDetail)

  const [detail, setDetail] = useState<IndexDetail | null>(null)
  const [docs, setDocs] = useState<SearchResults | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(0)
  const [aliasInput, setAliasInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [reindexOpen, setReindexOpen] = useState(false)
  const [editDoc, setEditDoc] = useState<{ docId: string; source: Record<string, unknown> } | null>(
    null,
  )
  const [newDocOpen, setNewDocOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [copiedDocId, setCopiedDocId] = useState<string | null>(null)

  const headerRef = useRef<HTMLDivElement | null>(null)

  const indexStatus = indices.find((i) => i.name === indexName)?.status ?? null

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetail(null)
    setDocs(null)

    // Two independent requests: a closed index fails _search but details are still useful.
    api
      .fetchIndexDetail(activeId, indexName)
      .then((d) => !cancelled && setDetail(d))
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false))

    api
      .search(activeId, {
        index: indexName,
        body: { size: pageSize, from: page * pageSize, query: { match_all: {} } },
      })
      .then((r) => {
        if (cancelled) return
        setDocs(r)
        if (r.hits.length === 0 && page > 0) {
          setPage(page - 1)
        }
      })
      .catch(() => {}) // sample docs are best-effort

    return () => {
      cancelled = true
    }
  }, [activeId, indexName, reloadTick, page, pageSize])

  // Close the manage dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(e: MouseEvent): void {
      if (headerRef.current != null && !headerRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [menuOpen])

  // Close the manage dropdown on Esc
  useEffect(() => {
    if (!menuOpen) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  function reload(): void {
    setPage(0)
    reloadIndexDetail()
  }

  const totalDocs = docs?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalDocs / pageSize))
  const fromCount = page * pageSize + 1
  const toCount = Math.min((page + 1) * pageSize, totalDocs)

  async function copyDocument(docId: string, source: Record<string, unknown>): Promise<void> {
    try {
      await navigator.clipboard.writeText(JSON.stringify(source, null, 2))
      setCopiedDocId(docId)
      window.setTimeout(() => {
        setCopiedDocId((id) => (id === docId ? null : id))
      }, 1500)
    } catch {
      // clipboard may be unavailable; silently ignore
    }
  }

  async function runAction(action: PendingAction): Promise<void> {
    if (!activeId) return
    setBusy(true)
    setActionError(null)
    try {
      if (action.kind === 'delete') {
        await api.deleteIndex(activeId, indexName)
        setPending(null)
        setMenuOpen(false)
        onBack()
        await refreshCluster()
        return
      }
      if (action.kind === 'delete-doc') {
        await api.deleteDocument(activeId, indexName, action.docId)
        setPending(null)
        reload()
        await refreshCluster()
        return
      }
      if (action.kind === 'open') {
        await api.openIndex(activeId, indexName)
      } else if (action.kind === 'close') {
        await api.closeIndex(activeId, indexName)
      } else {
        await api.removeAlias(activeId, indexName, action.alias)
      }
      setPending(null)
      setMenuOpen(false)
      reload()
      await refreshCluster()
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function submitAlias(): Promise<void> {
    const alias = aliasInput.trim()
    if (!activeId || alias === '') return
    setBusy(true)
    setActionError(null)
    try {
      await api.addAlias(activeId, indexName, alias)
      setAliasInput('')
      setMenuOpen(false)
      reload()
      await refreshCluster()
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  if (!activeId) return null

  const aliasNames = detail ? Object.keys(detail.aliases) : []

  return (
    <div className="index-view">
      <div className="index-view-header" ref={headerRef}>
        <button className="btn btn-ghost" onClick={onBack}>
          ← Back to indices
        </button>
        <h2 className="mono">{indexName}</h2>
        <div className="dropdown-wrap">
          <button className="btn" onClick={() => setMenuOpen((v) => !v)} disabled={busy}>
            {busy ? 'Working…' : 'Manage ▾'}
          </button>
          {menuOpen && (
            <div className="dropdown">
              <button type="button" className="dropdown-item" onClick={() => setPending({ kind: 'delete' })}>
                <span className="preview danger-text">Delete index…</span>
              </button>
              {indexStatus === 'close' ? (
                <button type="button" className="dropdown-item" onClick={() => setPending({ kind: 'open' })}>
                  <span className="preview">Open index…</span>
                </button>
              ) : (
                <button type="button" className="dropdown-item" onClick={() => setPending({ kind: 'close' })}>
                  <span className="preview">Close index…</span>
                </button>
              )}
              <button type="button" className="dropdown-item" onClick={() => setReindexOpen(true)}>
                <span className="preview">Reindex…</span>
              </button>
              <button type="button" className="dropdown-item" onClick={() => setBulkOpen(true)}>
                <span className="preview">Bulk import…</span>
              </button>
              <button type="button" className="dropdown-item" onClick={() => setNewDocOpen(true)}>
                <span className="preview">New document…</span>
              </button>
              <div className="alias-form">
                <input
                  className="input"
                  placeholder="New alias name"
                  value={aliasInput}
                  onChange={(e) => setAliasInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submitAlias()
                    if (e.key === 'Escape') setMenuOpen(false)
                  }}
                />
                <button
                  className="btn btn-primary"
                  onClick={() => void submitAlias()}
                  disabled={busy || aliasInput.trim() === ''}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {actionError && <div className="banner banner-error">{actionError}</div>}
      {loading && <div className="loading">Loading…</div>}

      {detail && (
        <>
          <Section title={`Documents (${totalDocs} total)`} defaultOpen>
            <div className="docs-controls">
              <div className="page-size">
                Show{' '}
                <select
                  className="select-input"
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value))
                    setPage(0)
                  }}
                >
                  <option value={10}>10</option>
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>{' '}
                per page
              </div>
              <div className="pagination">
                <button
                  className="btn btn-sm"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                >
                  ← Prev
                </button>
                <span className="page-info">
                  {totalDocs > 0
                    ? `${fromCount}–${toCount} of ${totalDocs}`
                    : '0 results'}
                </span>
                <button
                  className="btn btn-sm"
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1 || totalDocs === 0}
                >
                  Next →
                </button>
              </div>
            </div>
            {docs && docs.hits.length > 0 ? (
              docs.hits.map((h) => (
                <details key={h._id} className="doc">
                  <summary className="doc-summary">
                    <span className="mono">{h._id}</span>
                    <span className="doc-summary-actions">
                      <button
                        className="icon-btn"
                        title={`Copy document "${h._id}" to clipboard`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          void copyDocument(h._id, h._source)
                        }}
                      >
                        {copiedDocId === h._id ? '✓' : '⧉'}
                      </button>
                      <button
                        className="icon-btn"
                        title={`Edit document "${h._id}"`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setEditDoc({ docId: h._id, source: h._source })
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="icon-btn danger"
                        title={`Delete document "${h._id}"`}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setPending({ kind: 'delete-doc', docId: h._id })
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  </summary>
                  <pre className="json">
                    <JsonView value={h._source} />
                  </pre>
                </details>
              ))
            ) : (
              <div className="muted">No sample documents (or the index is closed).</div>
            )}
          </Section>

          <Section title="Aliases">
            {aliasNames.length > 0 ? (
              <div>
                {aliasNames.map((alias) => (
                  <span key={alias} className="chip alias-chip">
                    {alias}
                    <button
                      className="icon-btn"
                      title={`Remove alias "${alias}"`}
                      onClick={() => setPending({ kind: 'remove-alias', alias })}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <div className="muted">No aliases</div>
            )}
          </Section>

          <Section title="Mappings">
            <pre className="json">
              <JsonView value={detail.mappings} />
            </pre>
          </Section>

          <Section title="Settings">
            <pre className="json">
              <JsonView value={detail.settings} />
            </pre>
          </Section>
        </>
      )}

      {pending?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete index"
          message={
            <>
              Delete index <span className="mono">{indexName}</span>? This cannot be undone.
            </>
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'delete-doc' && (
        <ConfirmDialog
          title="Delete document"
          message={
            <>
              Delete document <span className="mono">{pending.docId}</span> from index{' '}
              <span className="mono">{indexName}</span>? This cannot be undone.
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
              Open index <span className="mono">{indexName}</span>? It will become available for
              reads and writes again.
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
              Close index <span className="mono">{indexName}</span>? It will become unavailable for
              reads and writes until opened again.
            </>
          }
          confirmLabel="Close"
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'remove-alias' && (
        <ConfirmDialog
          title="Remove alias"
          message={
            <>
              Remove alias <span className="mono">{pending.alias}</span> from index{' '}
              <span className="mono">{indexName}</span>?
            </>
          }
          confirmLabel="Remove"
          onConfirm={() => void runAction(pending)}
          onCancel={() => setPending(null)}
        />
      )}

      {reindexOpen && (
        <ReindexDialog
          connectionId={activeId}
          sourceIndex={indexName}
          onClose={() => {
            setReindexOpen(false)
            reload()
            void refreshCluster()
          }}
        />
      )}

      {editDoc && (
        <DocumentDialog
          connectionId={activeId}
          indexName={indexName}
          docId={editDoc.docId}
          initialSource={editDoc.source}
          onClose={() => setEditDoc(null)}
          onSaved={() => {
            reload()
            void refreshCluster()
          }}
        />
      )}

      {newDocOpen && (
        <DocumentDialog
          connectionId={activeId}
          indexName={indexName}
          docId={null}
          onClose={() => setNewDocOpen(false)}
          onSaved={() => {
            reload()
            void refreshCluster()
          }}
        />
      )}

      {bulkOpen && (
        <BulkDialog
          connectionId={activeId}
          indexName={indexName}
          onClose={() => setBulkOpen(false)}
          onImported={() => {
            reload()
            void refreshCluster()
          }}
        />
      )}
    </div>
  )
}

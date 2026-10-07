import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { SearchHit, SearchResults, MsearchResults } from '../../../shared/types'
import { collectColumns } from '../../../shared/csv'
import { api, errorMessage } from '../api'
import {
  clearHistory,
  loadHistory,
  loadSnippets,
  pushHistory,
  removeHistoryEntry,
  removeSnippet,
  saveSnippet,
} from '../queryHistory'
import type { QueryHistoryEntry, QuerySnippet } from '../queryHistory'
import { useApp } from '../store'
import { extractFields, queryCompletionSource } from '../completions'
import type { FieldInfo } from '../completions'
import { JsonEditor } from './JsonEditor'
import { JsonView } from './JsonView'
import { DocumentDialog } from './DocumentDialog'
import { ExplainDialog } from './ExplainDialog'
import { ExportDialog } from './ExportDialog'
import { ProfilePanel } from './ProfilePanel'

const DEFAULT_QUERY = `{
  "size": 20,
  "query": { "match_all": {} }
}`

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]
const MAX_TABLE_COLUMNS = 10
const PREVIEW_LIMIT = 80
const TAB_TITLE_LIMIT = 24

interface LastQuery {
  index: string
  body: Record<string, unknown> | null
}



interface SnippetFormState {
  /** Present when renaming an existing snippet. */
  id?: string
  name: string
}

/** Escape everything except <em>/</em> markers emitted by the cluster highlighter. */
function escapeHighlight(s: string): string {
  return s
    .replace(/<(\/?em)>/gi, '\x00$1\x00')
    .replace(/&/g, '\u0026amp;')
    .replace(/</g, '\u0026lt;')
    .replace(/>/g, '\u0026gt;')
    .replace(/\x00(\/?)em\x00/gi, '<$1em>')
}

/** Plain (non-highlighted) cell text: objects/arrays stringified and truncated. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const s = JSON.stringify(v) ?? String(v)
  return s.length > 100 ? `${s.slice(0, 100)}…` : s
}

/** `HH:MM` for today, `dd.MM HH:MM` for older entries. */
function formatTime(at: number): string {
  const d = new Date(at)
  const now = new Date()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  if (sameDay) return `${hh}:${mm}`
  const dd = String(d.getDate()).padStart(2, '0')
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}.${mo} ${hh}:${mm}`
}

/** First non-empty line of the query body, truncated. */
function bodyPreview(body: string): string {
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0) ?? ''
  return line.length > PREVIEW_LIMIT ? `${line.slice(0, PREVIEW_LIMIT)}…` : line
}

function HighlightBlock({ highlight }: { highlight: Record<string, string[]> }) {
  return (
    <div className="hl-block">
      {Object.entries(highlight).map(([field, frags]) => (
        <div key={field} className="hl-field">
          <span className="muted">{field}: </span>
          <span
            className="hl"
            dangerouslySetInnerHTML={{ __html: escapeHighlight(frags.join(' … ')) }}
          />
        </div>
      ))}
    </div>
  )
}

interface Props {
  tabId: string
  /** Report the tab title (index pattern after a run) to the tab manager. */
  onTitle: (tabId: string, title: string) => void
}

/**
 * One query tab: editor, toolbar, results. Always mounted by the tab
 * manager (hidden via CSS when inactive) so background tabs keep their
 * state and in-flight requests are not interrupted.
 */
export function QueryTabView({ tabId, onTitle }: Props) {
  const activeId = useApp((s) => s.activeId)
  const indices = useApp((s) => s.indices)

  const [index, setIndex] = useState('')
  const [text, setText] = useState(DEFAULT_QUERY)
  const [result, setResult] = useState<SearchResults | null>(null)
  const [msearchResult, setMsearchResult] = useState<MsearchResults | null>(null)
  const [tookMs, setTookMs] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(20)
  const [viewMode, setViewMode] = useState<'table' | 'json' | 'profile'>('table')
  const [highlightOn, setHighlightOn] = useState(false)
  const [profileOn, setProfileOn] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [msearchExpanded, setMsearchExpanded] = useState<{ responseIdx: number; docId: string } | null>(null)
  const [lastQuery, setLastQuery] = useState<LastQuery | null>(null)

  const [history, setHistory] = useState<QueryHistoryEntry[]>(() => loadHistory())
  const [snippets, setSnippets] = useState<QuerySnippet[]>(() => loadSnippets())
  const [historyOpen, setHistoryOpen] = useState(false)
  const [snippetsOpen, setSnippetsOpen] = useState(false)
  const [snippetForm, setSnippetForm] = useState<SnippetFormState | null>(null)
  const [fields, setFields] = useState<FieldInfo[]>([])
  const [editDoc, setEditDoc] = useState<{ index: string; docId: string; source: Record<string, unknown> } | null>(null)
  const [explainDoc, setExplainDoc] = useState<{ index: string; docId: string } | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportInfo, setExportInfo] = useState<string | null>(null)
  const [indexDropdownOpen, setIndexDropdownOpen] = useState(false)

  const toolbarRef = useRef<HTMLDivElement | null>(null)
  // Fresh fields for the completion source without recreating it.
  const fieldsRef = useRef(fields)
  fieldsRef.current = fields

  // Load mapping fields for a concrete index (best-effort, debounced).
  useEffect(() => {
    const name = index.trim()
    if (!activeId || !name || name.includes('*')) {
      setFields([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .fetchIndexDetail(activeId, name)
        .then((detail) => {
          if (!cancelled) setFields(extractFields(detail.mappings))
        })
        .catch(() => {
          // best-effort: ignore mapping load errors
        })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activeId, index])

  // Close snippets dropdown on outside click
  useEffect(() => {
    if (!snippetsOpen) return
    function onPointerDown(e: MouseEvent): void {
      if (toolbarRef.current != null && !toolbarRef.current.contains(e.target as Node)) {
        setSnippetsOpen(false)
        setSnippetForm(null)
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [snippetsOpen])

  // Close snippets dropdown on Esc
  useEffect(() => {
    if (!snippetsOpen) return
    function onKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        setSnippetsOpen(false)
        setSnippetForm(null)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [snippetsOpen])

  function toggleSnippets(): void {
    setSnippetsOpen((prev) => !prev)
    setSnippetForm(null)
  }

  async function execute(
    query: LastQuery,
    targetPage: number,
    size: number,
    highlight: boolean,
    profile: boolean,
  ): Promise<boolean> {
    if (!activeId) return false
    setError(null)
    setRunning(true)
    const effective: Record<string, unknown> = {
      ...(query.body ?? {}),
      from: targetPage * size,
      size,
    }
    if (highlight && query.body?.highlight === undefined) {
      effective.highlight = { fields: { '*': {} } }
    }
    if (profile && query.body?.profile === undefined) {
      effective.profile = true
    }
    const started = performance.now()
    try {
      const res = await api.search(activeId, { index: query.index, body: effective })
      setTookMs(Math.round(performance.now() - started))
      setResult(res)
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      setRunning(false)
    }
  }

  /** Detect NDJSON msearch format: even number of non-empty lines, every odd line is valid JSON object (header). */
  function isMsearchNdjson(s: string): boolean {
    const lines = s.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length === 0 || lines.length % 2 !== 0) return false
    for (let i = 0; i < lines.length; i += 2) {
      try {
        const parsed = JSON.parse(lines[i])
        if (parsed == null || typeof parsed !== 'object' || Array.isArray(parsed)) return false
      } catch {
        return false
      }
    }
    return true
  }

  async function runMsearch(): Promise<void> {
    if (!activeId) return
    setError(null)
    setMsearchResult(null)
    setMsearchExpanded(null)
    setResult(null)
    const ndjson = text.trim()
    if (!ndjson) {
      setError('NDJSON body is required for _msearch')
      return
    }
    if (!isMsearchNdjson(ndjson)) {
      setError('Invalid msearch format: expected even number of lines (header + body pairs)')
      return
    }
    setMsearchExpanded(null)
    setRunning(true)
    const started = performance.now()
    try {
      const res = await api.msearch(activeId, { index: index.trim() || null, ndjson: ndjson + '\n' })
      setTookMs(Math.round(performance.now() - started))
      setMsearchResult(res)
      setHistory(pushHistory({ index: index.trim(), body: text }))
      const pattern = index.trim() || '_msearch'
      onTitle(tabId, pattern.length > TAB_TITLE_LIMIT ? `${pattern.slice(0, TAB_TITLE_LIMIT)}…` : pattern)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  async function run(): Promise<void> {
    if (!activeId) return
    setError(null)
    setMsearchResult(null)

    let body: Record<string, unknown> | null = null
    if (text.trim()) {
      try {
        body = JSON.parse(text) as Record<string, unknown>
      } catch (e) {
        setError(`Invalid JSON: ${errorMessage(e)}`)
        return
      }
    }
    if (!index.trim()) {
      setError('Index is required')
      return
    }

    // On the first run, adopt the user's `size` as the page size.
    const userSize =
      body && typeof body.size === 'number' && Number.isFinite(body.size) && body.size > 0
        ? Math.floor(body.size)
        : null
    const size = userSize ?? pageSize

    setPageSize(size)
    setPage(0)
    setExpandedId(null)
    const query: LastQuery = { index: index.trim(), body }
    setLastQuery(query)
    const ok = await execute(query, 0, size, highlightOn, profileOn)
    if (ok) {
      // Name the tab after the index pattern it queried.
      const pattern = query.index
      onTitle(tabId, pattern.length > TAB_TITLE_LIMIT ? `${pattern.slice(0, TAB_TITLE_LIMIT)}…` : pattern)
      setHistory(pushHistory({ index: query.index, body: text }))
    }
  }

  function formatQuery(): void {
    if (!text.trim()) return
    try {
      const parsed: unknown = JSON.parse(text)
      setText(JSON.stringify(parsed, null, 2))
      setError(null)
    } catch {
      setError('Invalid JSON')
    }
  }

  function applyEntry(indexValue: string, body: string): void {
    setIndex(indexValue)
    setText(body)
    setHistoryOpen(false)
    setSnippetsOpen(false)
    setSnippetForm(null)
  }

  function submitSnippetForm(): void {
    if (snippetForm == null) return
    const name = snippetForm.name.trim()
    if (!name) return
    if (snippetForm.id != null) {
      const existing = snippets.find((s) => s.id === snippetForm.id)
      if (existing != null) {
        setSnippets(saveSnippet({ id: existing.id, name, index: existing.index, body: existing.body }))
      }
    } else {
      setSnippets(saveSnippet({ name, index: index.trim(), body: text }))
    }
    setSnippetForm(null)
  }

  function goTo(targetPage: number): void {
    if (!lastQuery || running) return
    setPage(targetPage)
    setExpandedId(null)
    void execute(lastQuery, targetPage, pageSize, highlightOn, profileOn)
  }

  function changePageSize(size: number): void {
    setPageSize(size)
    setPage(0)
    setExpandedId(null)
    if (lastQuery) void execute(lastQuery, 0, size, highlightOn, profileOn)
  }

  function toggleHighlight(): void {
    const next = !highlightOn
    setHighlightOn(next)
    if (lastQuery) {
      setPage(0)
      setExpandedId(null)
      void execute(lastQuery, 0, pageSize, next, profileOn)
    }
  }

  function toggleProfile(): void {
    const next = !profileOn
    setProfileOn(next)
    if (lastQuery) {
      setPage(0)
      setExpandedId(null)
      void execute(lastQuery, 0, pageSize, highlightOn, next)
    }
  }

  const totalPages = result?.total != null ? Math.max(1, Math.ceil(result.total / pageSize)) : null
  const canPrev = page > 0 && !running
  const canNext =
    !running &&
    result != null &&
    (totalPages != null ? page + 1 < totalPages : result.hits.length >= pageSize)

  function buildColumns(hits: SearchHit[]): string[] {
  const cols: string[] = ['_index', '_id']
  for (const h of hits) {
    for (const key of Object.keys(h._source ?? {})) {
      if (cols.length >= MAX_TABLE_COLUMNS) return cols
      if (!cols.includes(key)) cols.push(key)
    }
  }
  return cols
}

function renderCell(hit: SearchHit, column: string): ReactNode {
  if (column === '_index') return hit._index
  if (column === '_id') return hit._id
  const frags = hit.highlight?.[column]
  if (frags != null && frags.length > 0) {
    return (
      <span
        className="hl"
        dangerouslySetInnerHTML={{ __html: escapeHighlight(frags.join(' … ')) }}
      />
    )
  }
  return cellText(hit._source?.[column])
}

  /** Union of top-level _source fields across hits, first occurrence wins. */
  const columns = useMemo(() => {
    if (!result) return []
    return buildColumns(result.hits)
  }, [result])

  /** Top-level _source fields offered by the export dialog. */
  const availableColumns = useMemo(
    () => (result ? collectColumns(result.hits, false) : []),
    [result],
  )

  /** The .query part of the last executed body, for the explain API. */
  const explainQueryBody = useMemo(
    () =>
      lastQuery?.body?.query != null && typeof lastQuery.body.query === 'object' &&
      !Array.isArray(lastQuery.body.query)
        ? (lastQuery.body.query as Record<string, unknown>)
        : null,
    [lastQuery],
  )

  const sizeOptions = PAGE_SIZE_OPTIONS.includes(pageSize)
    ? PAGE_SIZE_OPTIONS
    : [...PAGE_SIZE_OPTIONS, pageSize].sort((a, b) => a - b)

  return (
    <div className="query">
      <div className="toolbar" ref={toolbarRef}>
        <div className="dropdown-wrap" style={{ flex: '1 1 auto', display: 'flex' }}>
          <input
            className="input mono"
            placeholder="Index pattern, e.g. logs-*"
            value={index}
            onChange={(e) => setIndex(e.target.value)}
          />
          <button
            className="btn"
            onClick={() => setIndexDropdownOpen((v) => !v)}
            title="Select index"
          >
            ▼
          </button>
          {indexDropdownOpen && (
            <div className="dropdown" style={{ maxHeight: '20rem', overflow: 'auto', minWidth: '100%' }}>
              {indices.length === 0 ? (
                <div className="dropdown-empty">No indices</div>
              ) : (
                indices.map((i) => (
                  <div
                    key={i.name}
                    className="dropdown-item"
                    onClick={() => {
                      setIndex(i.name)
                      setIndexDropdownOpen(false)
                    }}
                  >
                    <span className="preview">{i.name}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <button
          className="btn"
          onClick={() => setHistoryOpen(true)}
          title="Recently executed queries"
        >
          History ({history.length})
        </button>
        {historyOpen && (
          <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setHistoryOpen(false)}>
            <div className="modal history-modal">
              <h2>Query History</h2>
              {history.length === 0 ? (
                <div className="dropdown-empty">No history yet — run a query first</div>
              ) : (
                <div className="history-list">
                  {history.map((h) => (
                    <div
                      key={h.id}
                      className="dropdown-item"
                      onClick={() => {
                        applyEntry(h.index, h.body)
                        setHistoryOpen(false)
                      }}
                      title={h.body}
                    >
                      <span className="meta">{formatTime(h.at)}</span>
                      <span className="meta">{h.index || '—'}</span>
                      <span className="preview">{bodyPreview(h.body)}</span>
                      <span className="item-actions">
                        <button
                          className="icon-btn"
                          title="Remove from history"
                          onClick={(e) => {
                            e.stopPropagation()
                            setHistory(removeHistoryEntry(h.id))
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="modal-footer">
                {history.length > 0 && (
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      clearHistory()
                      setHistory([])
                    }}
                  >
                    Clear all
                  </button>
                )}
                <span className="spacer" />
                <button className="btn btn-primary" onClick={() => setHistoryOpen(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="dropdown-wrap">
          <button
            className="btn"
            onClick={() => toggleSnippets()}
            title="Saved query snippets"
          >
            Snippets ({snippets.length})
          </button>
          {snippetsOpen && (
            <div className="dropdown">
              {snippetForm != null && (
                <div className="snippet-form">
                  <input
                    className="input"
                    autoFocus
                    placeholder="Snippet name"
                    value={snippetForm.name}
                    onChange={(e) => setSnippetForm({ ...snippetForm, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitSnippetForm()
                      if (e.key === 'Escape') setSnippetForm(null)
                    }}
                  />
                  <button className="btn btn-primary" onClick={submitSnippetForm}>
                    Save
                  </button>
                  <button className="btn" onClick={() => setSnippetForm(null)}>
                    Cancel
                  </button>
                </div>
              )}
              {snippets.length === 0 && snippetForm == null ? (
                <div className="dropdown-empty">No snippets yet — save your current query</div>
              ) : (
                snippets.map((s) => (
                  <div
                    key={s.id}
                    className="dropdown-item"
                    onClick={() => applyEntry(s.index, s.body)}
                    title={s.body}
                  >
                    <span className="meta">{s.index || '—'}</span>
                    <span className="preview">
                      {s.name} <span className="muted">{bodyPreview(s.body)}</span>
                    </span>
                    <span className="item-actions">
                      <button
                        className="icon-btn"
                        title="Rename"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSnippetForm({ id: s.id, name: s.name })
                        }}
                      >
                        ✎
                      </button>
                      <button
                        className="icon-btn"
                        title="Delete snippet"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSnippets(removeSnippet(s.id))
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  </div>
                ))
              )}
              <div className="dropdown-footer">
                <button
                  className="btn btn-ghost"
                  onClick={() => setSnippetForm({ name: '' })}
                  disabled={snippetForm != null}
                >
                  + Save current
                </button>
              </div>
            </div>
          )}
        </div>

        <button className="btn" onClick={formatQuery} title="Pretty-print the query body">
          Format
        </button>
        <button
          className={highlightOn ? 'btn btn-primary' : 'btn'}
          onClick={toggleHighlight}
          title="Add highlight: { fields: { '*': {} } } to the request body"
        >
          Highlight
        </button>
        <button
          className={profileOn ? 'btn btn-primary' : 'btn'}
          onClick={toggleProfile}
          title='Add "profile": true to the request body'
        >
          Profile
        </button>
        <button className="btn btn-primary" onClick={() => void run()} disabled={running}>
          {running ? 'Running…' : 'Run  (Ctrl+Enter)'}
        </button>
        <button className="btn btn-primary" onClick={() => void runMsearch()} disabled={running} title="Run as _msearch (NDJSON pairs)">
          {running ? 'Running…' : 'Msearch'}
        </button>
      </div>

      <JsonEditor
        value={text}
        onChange={setText}
        onRun={() => void (isMsearchNdjson(text.trim()) ? runMsearch() : run())}
        minHeight="160px"
        completions={queryCompletionSource(() => fieldsRef.current)}
      />

      {error && <div className="banner banner-error">{error}</div>}
      {exportInfo && <div className="banner banner-ok">{exportInfo}</div>}

      {result && (
        <div className="query-result">
          <div className="result-header">
            <div className="result-tabs">
              <button
                className={`tab${viewMode === 'table' ? ' active' : ''}`}
                onClick={() => setViewMode('table')}
              >
                Table
              </button>
              <button
                className={`tab${viewMode === 'json' ? ' active' : ''}`}
                onClick={() => setViewMode('json')}
              >
                JSON
              </button>
              <button
                className={`tab${viewMode === 'profile' ? ' active' : ''}`}
                onClick={() => setViewMode('profile')}
              >
                Profile
              </button>
            </div>
            <span className="muted">
              {result.total ?? result.hits.length} hits · {tookMs}ms
            </span>
            <span className="spacer" />
            <button
              className="btn"
              onClick={() => setExportOpen(true)}
              disabled={exporting || result.hits.length === 0}
              title="Export all matching documents to a CSV or JSON file"
            >
              {exporting ? 'Exporting…' : 'Export…'}
            </button>
          </div>

          {viewMode === 'table' ? (
            result.hits.length > 0 ? (
              <table className="table table-hover result-table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.hits.map((h) => (
                    <Fragment key={`${h._index}/${h._id}`}>
                      <tr
                        onClick={() => setExpandedId(expandedId === h._id ? null : h._id)}
                      >
                        {columns.map((c) => (
                          <td key={c}>{renderCell(h, c)}</td>
                        ))}
                      </tr>
                      {expandedId === h._id && (
                        <tr className="doc-row-expanded">
                          <td colSpan={columns.length}>
                            {h.highlight && <HighlightBlock highlight={h.highlight} />}
                            <div className="doc-actions">
                              <button
                                className="btn"
                                onClick={() =>
                                  setEditDoc({ index: h._index, docId: h._id, source: h._source })
                                }
                              >
                                Edit
                              </button>
                              <button
                                className="btn"
                                onClick={() => setExplainDoc({ index: h._index, docId: h._id })}
                                title="Explain the score of this document for the current query"
                              >
                                Explain
                              </button>
                            </div>
                            <pre className="json">
                              <JsonView value={h._source} />
                            </pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="muted">No hits</div>
            )
          ) : viewMode === 'profile' ? (
            <ProfilePanel profile={result.raw.profile} />
          ) : result.hits.length > 0 ? (
            result.hits.map((h) => (
              <details key={`${h._index}/${h._id}`} className="doc">
                <summary>
                  <span className="mono muted">{h._index}</span>
                  <span className="mono">{h._id}</span>
                </summary>
                {h.highlight && <HighlightBlock highlight={h.highlight} />}
                <pre className="json">
                  <JsonView value={h._source} />
                </pre>
              </details>
            ))
          ) : (
            <div className="muted">No hits</div>
          )}

          <div className="pager">
            <button className="btn" disabled={!canPrev} onClick={() => goTo(page - 1)}>
              ‹ Prev
            </button>
            <span className="muted">
              Page {page + 1}
              {totalPages != null ? ` of ${totalPages}` : ''}
            </span>
            <button className="btn" disabled={!canNext} onClick={() => goTo(page + 1)}>
              Next ›
            </button>
            <select
              className="input"
              value={pageSize}
              onChange={(e) => changePageSize(Number(e.target.value))}
            >
              {sizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n} / page
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {msearchResult && (
        <div className="query-result">
          <div className="result-header">
            <span className="muted">
              {msearchResult.responses.length} responses{tookMs != null ? ` · ${tookMs}ms` : ''}
            </span>
          </div>
          {msearchResult.responses.map((r, ri) => {
            const mcols = buildColumns(r.hits)
            return (
              <div key={ri} className="msearch-item">
                <div className="result-header">
                  <span className="muted">
                    Response #{ri + 1}: {r.hits.length} hits
                    {r.status !== 200 ? ` · status ${r.status}` : ''}
                  </span>
                </div>
                {r.hits.length > 0 ? (
                  <table className="table table-hover result-table">
                    <thead>
                      <tr>
                        {mcols.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {r.hits.map((h) => (
                        <Fragment key={`${h._index}/${h._id}`}>
                          <tr
                            onClick={() =>
                              setMsearchExpanded(
                                msearchExpanded?.responseIdx === ri && msearchExpanded?.docId === h._id
                                  ? null
                                  : { responseIdx: ri, docId: h._id },
                              )
                            }
                          >
                            {mcols.map((c) => (
                              <td key={c}>{renderCell(h, c)}</td>
                            ))}
                          </tr>
                          {msearchExpanded?.responseIdx === ri && msearchExpanded?.docId === h._id && (
                            <tr className="doc-row-expanded">
                              <td colSpan={mcols.length}>
                                {h.highlight && <HighlightBlock highlight={h.highlight} />}
                                <div className="doc-actions">
                                  <button
                                    className="btn"
                                    onClick={() =>
                                      setEditDoc({ index: h._index, docId: h._id, source: h._source })
                                    }
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="btn"
                                    onClick={() => setExplainDoc({ index: h._index, docId: h._id })}
                                    title="Explain the score of this document for the current query"
                                  >
                                    Explain
                                  </button>
                                </div>
                                <pre className="json">
                                  <JsonView value={h._source} />
                                </pre>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="muted">No hits</div>
                )}
                <details className="doc">
                  <summary>
                    <span className="mono muted">Raw response</span>
                  </summary>
                  <pre className="json">
                    <JsonView value={r.raw} />
                  </pre>
                </details>
              </div>
            )
          })}
        </div>
      )}

      {editDoc && activeId && (
        <DocumentDialog
          connectionId={activeId}
          indexName={editDoc.index}
          docId={editDoc.docId}
          initialSource={editDoc.source}
          onClose={() => setEditDoc(null)}
          onSaved={() => {
            if (lastQuery) void execute(lastQuery, page, pageSize, highlightOn, profileOn)
          }}
        />
      )}

      {explainDoc && activeId && (
        <ExplainDialog
          connectionId={activeId}
          indexName={explainDoc.index}
          docId={explainDoc.docId}
          queryBody={explainQueryBody}
          onClose={() => setExplainDoc(null)}
        />
      )}

      {exportOpen && activeId && lastQuery && (
        <ExportDialog
          connectionId={activeId}
          index={lastQuery.index}
          body={lastQuery.body}
          availableColumns={availableColumns}
          onClose={() => setExportOpen(false)}
          onStart={() => {
            setExporting(true)
            setExportInfo(null)
          }}
          onExported={(path) => {
            setExporting(false)
            if (path) setExportInfo(`Exported to ${path}`)
          }}
          onError={(msg) => {
            setExporting(false)
            setError(msg)
          }}
        />
      )}
    </div>
  )
}

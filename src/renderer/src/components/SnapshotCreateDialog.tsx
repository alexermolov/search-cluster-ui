import { useEffect, useMemo, useState } from 'react'
import type { SnapshotRepository } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../store'
import { JsonEditor } from './JsonEditor'
import { JsonView } from './JsonView'

interface Props {
  connectionId: string
  onClose: () => void
  onCreated: () => void
}

/**
 * Snapshot creation wizard: repository + snapshot name + index selection
 * (all indices by default) + optional advanced JSON merged into the request.
 */
export function SnapshotCreateDialog({ connectionId, onClose, onCreated }: Props) {
  const indices = useApp((s) => s.indices)
  const [repos, setRepos] = useState<SnapshotRepository[]>([])
  const [repo, setRepo] = useState('')
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [advanced, setAdvanced] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .fetchRepositories(connectionId)
      .then((r) => {
        if (cancelled) return
        setRepos(r)
        if (r.length > 0) setRepo(r[0].id)
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
    return () => {
      cancelled = true
    }
  }, [connectionId])

  const allSelected = selected.size === 0
  const indexNames = useMemo(() => indices.map((i) => i.name), [indices])

  function toggleIndex(name: string): void {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function run(): Promise<void> {
    const snapshot = name.trim()
    if (!repo) {
      setError('Select a repository')
      return
    }
    if (snapshot === '') {
      setError('Snapshot name is required')
      return
    }

    let parsed: Record<string, unknown> | null = null
    const text = advanced.trim()
    if (text !== '') {
      try {
        const v: unknown = JSON.parse(text)
        if (v === null || typeof v !== 'object' || Array.isArray(v)) {
          setError('Advanced JSON must be an object, e.g. {"ignore_unavailable": true}')
          return
        }
        parsed = v as Record<string, unknown>
      } catch {
        setError('Advanced JSON is not valid JSON')
        return
      }
    }

    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.createSnapshot(connectionId, {
        repository: repo,
        snapshot,
        indices: [...selected],
        body: parsed,
      })
      setResult(res)
      onCreated()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  const accepted = result ? (result.accepted as boolean) : null

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal snapshot-modal">
        <h2>Create snapshot</h2>

        <div className="field-row">
          <div className="field">
            <span>Repository</span>
            <select
              className="input"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              disabled={repos.length === 0}
            >
              {repos.length === 0 && <option value="">No repositories</option>}
              {repos.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id} ({r.type})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <span>Snapshot name</span>
            <input
              className="input mono"
              placeholder="e.g. daily-2026-09-30"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void run()
                if (e.key === 'Escape') onClose()
              }}
            />
          </div>
        </div>

        <div className="field">
          <span>
            Indices {allSelected ? '(all — none selected)' : `(${selected.size} selected)`}
          </span>
          <div className="export-cols">
            <label className="export-cols-label">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set(indexNames) : new Set())}
              />
              All indices (default)
            </label>
            {indexNames.map((n) => (
              <label key={n}>
                <input
                  type="checkbox"
                  checked={selected.has(n)}
                  onChange={() => toggleIndex(n)}
                />
                <span className="mono">{n}</span>
              </label>
            ))}
            {indexNames.length === 0 && <div className="muted">No indices loaded</div>}
          </div>
        </div>

        <div className="field">
          <span>Advanced (optional JSON, merged into the request)</span>
          <JsonEditor
            value={advanced}
            onChange={setAdvanced}
            placeholder={'{"ignore_unavailable": true, "partial": false}'}
            minHeight="100px"
          />
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        {result && (
          <div className="banner banner-ok">
            Snapshot started{accepted === false ? '' : ' (accepted)'}
            <pre className="json">
              <JsonView value={result} />
            </pre>
          </div>
        )}

        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={running}>
            {result ? 'Close' : 'Cancel'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={running || repos.length === 0}
          >
            {running ? 'Creating…' : 'Create snapshot'}
          </button>
        </div>
      </div>
    </div>
  )
}

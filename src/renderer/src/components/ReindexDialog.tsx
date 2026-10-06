import { useState } from 'react'
import { api, errorMessage } from '../api'
import { JsonEditor } from './JsonEditor'
import { JsonView } from './JsonView'

interface Props {
  connectionId: string
  sourceIndex: string
  onClose: () => void
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function failuresOf(res: Record<string, unknown>): Record<string, unknown>[] {
  const f = res.failures
  return Array.isArray(f) ? (f.filter((x) => typeof x === 'object' && x !== null) as Record<string, unknown>[]) : []
}

/**
 * Reindex wizard: destination index + optional advanced JSON body
 * (merged on the top level of the reindex request).
 */
export function ReindexDialog({ connectionId, sourceIndex, onClose }: Props) {
  const [dest, setDest] = useState('')
  const [advanced, setAdvanced] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  async function run(): Promise<void> {
    const target = dest.trim()
    if (!target) {
      setError('Destination index is required')
      return
    }

    let parsed: Record<string, unknown> | null = null
    const text = advanced.trim()
    if (text !== '') {
      try {
        const v: unknown = JSON.parse(text)
        if (v === null || typeof v !== 'object' || Array.isArray(v)) {
          setError('Advanced JSON must be an object, e.g. {"query": {...}}')
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
      const res = await api.reindex(connectionId, sourceIndex, target, parsed)
      setResult(res)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  const failures = result ? failuresOf(result) : []
  const took = result ? num(result.took) : null
  const created = result ? num(result.created) : null
  const updated = result ? num(result.updated) : null
  const deleted = result ? num(result.deleted) : null

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal reindex-modal">
        <h2>Reindex "{sourceIndex}"</h2>

        <div className="field">
          <span>Destination index</span>
          <input
            className="input mono"
            autoFocus
            placeholder="e.g. logs-v2"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run()
              if (e.key === 'Escape') onClose()
            }}
          />
        </div>

        <div className="field">
          <span>Advanced (optional JSON, merged into the request)</span>
          <JsonEditor
            value={advanced}
            onChange={setAdvanced}
            placeholder={'{"query": {...}, "size": 1000}'}
            minHeight="120px"
          />
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        {result && (
          <div className="reindex-result">
            <div className="reindex-stats">
              <div className="card">
                <div className="card-label">Took</div>
                <div className="card-value">{took !== null ? `${took} ms` : '—'}</div>
              </div>
              <div className="card">
                <div className="card-label">Created</div>
                <div className="card-value">{created ?? '—'}</div>
              </div>
              <div className="card">
                <div className="card-label">Updated</div>
                <div className="card-value">{updated ?? '—'}</div>
              </div>
              <div className="card">
                <div className="card-label">Deleted</div>
                <div className="card-value">{deleted ?? '—'}</div>
              </div>
            </div>
            {failures.length === 0 ? (
              <div className="banner banner-ok">No failures</div>
            ) : (
              <div className="banner banner-error">
                {failures.length} failure{failures.length === 1 ? '' : 's'}
                <pre className="json">
                  <JsonView value={failures.slice(0, 3)} />
                </pre>
              </div>
            )}
          </div>
        )}

        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={running}>
            {result ? 'Close' : 'Cancel'}
          </button>
          <button className="btn btn-primary" onClick={() => void run()} disabled={running}>
            {running ? 'Working…' : 'Reindex'}
          </button>
        </div>
      </div>
    </div>
  )
}

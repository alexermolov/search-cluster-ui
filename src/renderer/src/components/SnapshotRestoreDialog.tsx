import { useState } from 'react'
import { api, errorMessage } from '../api'
import { JsonEditor } from './JsonEditor'
import { JsonView } from './JsonView'

interface Props {
  connectionId: string
  repository: string
  snapshot: string
  onClose: () => void
  onRestored: () => void
}

/**
 * Snapshot restore wizard: rename pattern/replacement, index selection and
 * other options via a JSON body (indices, include_global_state, ...).
 */
export function SnapshotRestoreDialog({
  connectionId,
  repository,
  snapshot,
  onClose,
  onRestored,
}: Props) {
  const [renamePattern, setRenamePattern] = useState('')
  const [renameReplacement, setRenameReplacement] = useState('')
  const [includeGlobalState, setIncludeGlobalState] = useState(true)
  const [advanced, setAdvanced] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  async function run(): Promise<void> {
    let parsed: Record<string, unknown> | null = null
    const text = advanced.trim()
    if (text !== '') {
      try {
        const v: unknown = JSON.parse(text)
        if (v === null || typeof v !== 'object' || Array.isArray(v)) {
          setError('Advanced JSON must be an object, e.g. {"indices": ["logs-*"]}')
          return
        }
        parsed = v as Record<string, unknown>
      } catch {
        setError('Advanced JSON is not valid JSON')
        return
      }
    }

    const body: Record<string, unknown> = { ...(parsed ?? {}) }
    if (renamePattern.trim() !== '') body.rename_pattern = renamePattern.trim()
    if (renameReplacement.trim() !== '') body.rename_replacement = renameReplacement.trim()
    body.include_global_state = includeGlobalState

    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.restoreSnapshot(connectionId, {
        repository,
        snapshot,
        body,
      })
      setResult(res)
      onRestored()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal snapshot-modal">
        <h2>
          Restore snapshot <span className="mono">{snapshot}</span>
        </h2>
        <div className="muted">
          from repository <span className="mono">{repository}</span>
        </div>

        <div className="field-row">
          <div className="field">
            <span>Rename pattern (optional regex)</span>
            <input
              className="input mono"
              placeholder="e.g. (.+)"
              value={renamePattern}
              onChange={(e) => setRenamePattern(e.target.value)}
            />
          </div>
          <div className="field">
            <span>Rename replacement</span>
            <input
              className="input mono"
              placeholder="e.g. restored_$1"
              value={renameReplacement}
              onChange={(e) => setRenameReplacement(e.target.value)}
            />
          </div>
        </div>

        <div className="field checkbox">
          <input
            type="checkbox"
            id="restore-global-state"
            checked={includeGlobalState}
            onChange={(e) => setIncludeGlobalState(e.target.checked)}
          />
          <label htmlFor="restore-global-state">Include global state</label>
        </div>

        <div className="field">
          <span>Advanced (optional JSON, merged into the request)</span>
          <JsonEditor
            value={advanced}
            onChange={setAdvanced}
            placeholder={'{"indices": ["logs-*"], "index_settings": {...}}'}
            minHeight="100px"
          />
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        {result && (
          <div className="banner banner-ok">
            Restore started
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
          <button className="btn btn-primary" onClick={() => void run()} disabled={running}>
            {running ? 'Restoring…' : 'Restore'}
          </button>
        </div>
      </div>
    </div>
  )
}

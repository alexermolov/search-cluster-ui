import { useRef, useState } from 'react'
import type { BulkResult } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { JsonEditor } from './JsonEditor'
import { JsonView } from './JsonView'

interface Props {
  connectionId: string
  indexName: string
  onClose: () => void
  /** Called after a successful import. */
  onImported: () => void
}

const SAMPLE = `{"index": {"_id": "1"}}
{"title": "First doc"}
{"index": {"_id": "2"}}
{"title": "Second doc"}`

/**
 * Bulk import: paste NDJSON (action/source line pairs) or pick a .ndjson/.json
 * file, then send it to _bulk and show the per-item report.
 */
export function BulkDialog({ connectionId, indexName, onClose, onImported }: Props) {
  const [text, setText] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<BulkResult | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  function pickFile(): void {
    fileRef.current?.click()
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    try {
      setText(await file.text())
      setError(null)
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function run(): Promise<void> {
    const ndjson = text.trim()
    if (ndjson === '') {
      setError('Paste NDJSON or pick a file first')
      return
    }
    // Cheap sanity check: NDJSON must have an even number of non-empty lines
    // (action + source pairs).
    const lines = ndjson.split('\n').filter((l) => l.trim() !== '')
    if (lines.length % 2 !== 0) {
      setError(
        'Expected an even number of non-empty lines (action line + source line pairs). ' +
          'Check the NDJSON format.',
      )
      return
    }

    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.bulk(connectionId, { index: indexName, ndjson: ndjson + '\n' })
      setResult(res)
      if (!res.errors) onImported()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  const failed = result?.items.filter((i) => i.error != null) ?? []
  const okCount = result ? result.items.length - failed.length : 0

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal bulk-modal">
        <h2>
          Bulk import <span className="mono muted">{indexName}</span>
        </h2>

        <div className="muted">
          NDJSON: an action line (<span className="mono">index/create/update/delete</span>) followed
          by its source line. The index defaults to <span className="mono">{indexName}</span>;
          override with <span className="mono">_index</span> in the action line.
        </div>

        <JsonEditor
          value={text}
          onChange={setText}
          onRun={() => void run()}
          placeholder={SAMPLE}
          minHeight="200px"
        />

        <input
          ref={fileRef}
          type="file"
          accept=".ndjson,.json,.txt"
          style={{ display: 'none' }}
          onChange={(e) => void onFile(e)}
        />

        {error && <div className="banner banner-error">{error}</div>}

        {result && (
          <div className="reindex-result">
            <div className="reindex-stats">
              <div className="card">
                <div className="card-label">Took</div>
                <div className="card-value">{result.took ?? '—'} ms</div>
              </div>
              <div className="card">
                <div className="card-label">Items</div>
                <div className="card-value">{result.items.length}</div>
              </div>
              <div className="card">
                <div className="card-label">Succeeded</div>
                <div className="card-value">{okCount}</div>
              </div>
              <div className="card">
                <div className="card-label">Failed</div>
                <div className="card-value">{failed.length}</div>
              </div>
            </div>
            {failed.length === 0 ? (
              <div className="banner banner-ok">No failures</div>
            ) : (
              <div className="banner banner-error">
                {failed.length} failure{failed.length === 1 ? '' : 's'}
                <pre className="json">
                  <JsonView value={failed.slice(0, 5)} />
                </pre>
              </div>
            )}
          </div>
        )}

        <div className="modal-footer">
          <button className="btn" onClick={pickFile} disabled={running}>
            Pick file…
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={running}>
            {result ? 'Close' : 'Cancel'}
          </button>
          <button className="btn btn-primary" onClick={() => void run()} disabled={running}>
            {running ? 'Importing…' : 'Import  (Ctrl+Enter)'}
          </button>
        </div>
      </div>
    </div>
  )
}

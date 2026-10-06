import { useEffect, useState } from 'react'
import { api, errorMessage } from '../api'
import { JsonEditor } from './JsonEditor'

interface Props {
  connectionId: string
  indexName: string
  /** null — creating a new document; otherwise the document being edited. */
  docId: string | null
  /** Initial source when known (e.g. from a search hit); otherwise fetched. */
  initialSource?: Record<string, unknown> | null
  onClose: () => void
  /** Called after a successful save/create. */
  onSaved: () => void
}

/**
 * View / edit / create a single document in the JsonEditor.
 * Editing replaces the whole _source via PUT /{index}/_doc/{id};
 * creating uses POST /{index}/_doc with a cluster-generated id.
 */
export function DocumentDialog({
  connectionId,
  indexName,
  docId,
  initialSource = null,
  onClose,
  onSaved,
}: Props) {
  const creating = docId == null
  const [text, setText] = useState(() => JSON.stringify(initialSource ?? {}, null, 2))
  const [loading, setLoading] = useState(!creating && initialSource == null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  // Fetch the fresh source when editing without a known one.
  useEffect(() => {
    if (creating || initialSource != null || docId == null) return
    let cancelled = false
    setLoading(true)
    api
      .getDocument(connectionId, indexName, docId)
      .then((source) => {
        if (!cancelled) setText(JSON.stringify(source, null, 2))
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [connectionId, indexName, docId, creating, initialSource])

  async function save(): Promise<void> {
    let source: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(text)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setError('Document must be a JSON object')
        return
      }
      source = parsed as Record<string, unknown>
    } catch (e) {
      setError(`Invalid JSON: ${errorMessage(e)}`)
      return
    }

    setSaving(true)
    setError(null)
    try {
      const res = creating
        ? await api.createDocument(connectionId, indexName, source)
        : await api.saveDocument(connectionId, indexName, docId as string, source)
      const newId = creating && typeof res._id === 'string' ? res._id : null
      if (newId) setSavedId(newId)
      onSaved()
      if (!newId) onClose()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal doc-modal">
        <h2>
          {creating ? 'New document' : 'Document'} <span className="mono muted">{indexName}</span>
          {!creating && <span className="mono muted">· {docId}</span>}
        </h2>

        {loading ? (
          <div className="loading">Loading…</div>
        ) : (
          <JsonEditor
            value={text}
            onChange={setText}
            onRun={() => void save()}
            placeholder='{"field": "value"}'
            minHeight="240px"
          />
        )}

        {error && <div className="banner banner-error">{error}</div>}

        {savedId && (
          <div className="banner banner-ok">
            Created document <span className="mono">{savedId}</span>
          </div>
        )}

        <div className="modal-footer">
          <span className="muted">Ctrl+Enter to save</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={saving}>
            {savedId ? 'Close' : 'Cancel'}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={saving || loading}
          >
            {saving ? 'Saving…' : creating ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

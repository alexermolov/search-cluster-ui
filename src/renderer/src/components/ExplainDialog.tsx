import { useEffect, useState } from 'react'
import { api, errorMessage } from '../api'
import { JsonView } from './JsonView'

interface Props {
  connectionId: string
  indexName: string
  docId: string
  /**
   * Query body of the last executed search (its .query part when present);
   * null sends match_all so the explain API always has a query.
   */
  queryBody: Record<string, unknown> | null
  onClose: () => void
}

/**
 * Score explanation for a single document: POST /{index}/_explain/{docId}.
 * Shows the raw explanation tree returned by the cluster.
 */
export function ExplainDialog({
  connectionId,
  indexName,
  docId,
  queryBody,
  onClose,
}: Props) {
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    api
      .explain(connectionId, { index: indexName, docId, body: queryBody })
      .then((res) => {
        if (!cancelled) setResult(res)
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [connectionId, indexName, docId, queryBody])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal doc-modal">
        <h2>
          Explain <span className="mono muted">{indexName}</span>
          <span className="mono muted">· {docId}</span>
        </h2>

        {loading ? (
          <div className="loading">Loading…</div>
        ) : error ? (
          <div className="banner banner-error">{error}</div>
        ) : (
          <pre className="json">
            <JsonView value={result} />
          </pre>
        )}

        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

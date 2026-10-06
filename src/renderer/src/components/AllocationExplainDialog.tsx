import { useEffect, useState } from 'react'
import { api, errorMessage } from '../api'
import { JsonView } from './JsonView'

interface Props {
  connectionId: string
  /** Pre-filled target when opened from an unassigned shard row; null = let the cluster pick. */
  target: { index: string; shard: string; primary: boolean } | null
  onClose: () => void
}

/**
 * /_cluster/allocation/explain viewer: why a shard is (or cannot be)
 * allocated. With a target it explains that exact shard; without one the
 * cluster picks the first unassigned shard.
 */
export function AllocationExplainDialog({ connectionId, target, onClose }: Props) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  async function run(): Promise<void> {
    setRunning(true)
    setError(null)
    try {
      const res = await api.allocationExplain(
        connectionId,
        target
          ? { index: target.index, shard: Number(target.shard), primary: target.primary }
          : { index: null, shard: null, primary: null },
      )
      setResult(res)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  // Run once on open.
  useEffect(() => {
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reason = result ? String(result.reason ?? '') : ''
  const decision = result ? String(result.decision ?? '') : ''
  const explainIndex = result ? String(result.index ?? '') : ''
  const explainShard = result ? String(result.shard ?? '') : ''

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal explain-modal">
        <h2>Allocation explain</h2>
        <div className="muted">
          {target ? (
            <>
              shard <span className="mono">{target.shard}</span> (
              {target.primary ? 'primary' : 'replica'}) of index{' '}
              <span className="mono">{target.index}</span>
            </>
          ) : (
            'first unassigned shard on the cluster'
          )}
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        {result && (
          <>
            <div className="field-row">
              <div className="card">
                <div className="card-label">Index</div>
                <div className="card-value mono">{explainIndex || '—'}</div>
              </div>
              <div className="card">
                <div className="card-label">Shard</div>
                <div className="card-value">{explainShard || '—'}</div>
              </div>
              <div className="card">
                <div className="card-label">Decision</div>
                <div className="card-value">{decision || '—'}</div>
              </div>
            </div>
            {reason && (
              <div className={`banner ${decision === 'YES' ? 'banner-ok' : 'banner-error'}`}>
                {reason}
              </div>
            )}
            <pre className="json">
              <JsonView value={result} />
            </pre>
          </>
        )}

        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn" onClick={() => void run()} disabled={running}>
            {running ? 'Explaining…' : 'Re-run'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

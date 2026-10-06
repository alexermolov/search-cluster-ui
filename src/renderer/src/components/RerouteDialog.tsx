import { useState } from 'react'
import { api, errorMessage } from '../api'
import { JsonEditor } from './JsonEditor'
import { JsonView } from './JsonView'

interface Props {
  connectionId: string
  onClose: () => void
  onRerouted: () => void
}

/**
 * Manual reroute: POST /_cluster/reroute with a JSON array of commands
 * (allocate, move, cancel, ...). The editor holds the array body.
 */
export function RerouteDialog({ connectionId, onClose, onRerouted }: Props) {
  const [commands, setCommands] = useState(
    '[\n  {\n    "allocate": {\n      "index": "my-index",\n      "shard": 0,\n      "node": "node-1",\n      "allow_primary": true\n    }\n  }\n]',
  )
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)

  async function run(): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(commands)
    } catch {
      setError('Commands are not valid JSON')
      return
    }
    if (!Array.isArray(parsed)) {
      setError('Commands must be a JSON array, e.g. [{"allocate": {...}}]')
      return
    }

    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.reroute(connectionId, {
        commands: parsed as Record<string, unknown>[],
      })
      setResult(res)
      onRerouted()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  const acknowledged = result ? (result.acknowledged as boolean) : null

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal reroute-modal">
        <h2>Manual reroute</h2>
        <div className="muted">
          POST /_cluster/reroute — an array of commands: allocate, move, cancel. Use with care;
          manual decisions override the allocator.
        </div>

        <div className="field">
          <span>Commands (JSON array)</span>
          <JsonEditor value={commands} onChange={setCommands} minHeight="160px" />
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        {result && (
          <div className="banner banner-ok">
            Reroute {acknowledged === false ? 'not acknowledged' : 'acknowledged'}
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
            {running ? 'Rerouting…' : 'Reroute'}
          </button>
        </div>
      </div>
    </div>
  )
}

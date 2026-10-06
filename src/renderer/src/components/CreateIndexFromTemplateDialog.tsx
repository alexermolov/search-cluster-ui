import { useState } from 'react'
import { api, errorMessage } from '../api'
import { JsonEditor } from './JsonEditor'
import { JsonView } from './JsonView'

interface Props {
  connectionId: string
  templateName: string
  onClose: () => void
  /** Called after the index was created successfully. */
  onCreated: () => void
}

/** Index names must be lowercase and free of these characters. */
const INVALID_INDEX_CHARS = /[\\/*?"<>| ,#]/

function validIndexName(name: string): boolean {
  return name !== '' && name === name.toLowerCase() && !INVALID_INDEX_CHARS.test(name)
}

/**
 * Create an index from a template: the cluster applies any matching index
 * template automatically; optional JSON overrides are merged into the
 * top-level PUT body. Preview runs _simulate_index for the template.
 */
export function CreateIndexFromTemplateDialog({ connectionId, templateName, onClose, onCreated }: Props) {
  const [indexName, setIndexName] = useState('')
  const [overrides, setOverrides] = useState('')
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [running, setRunning] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  function parseOverrides(): Record<string, unknown> | null | 'invalid' {
    const text = overrides.trim()
    if (text === '') return null
    try {
      const v: unknown = JSON.parse(text)
      if (v === null) return null
      if (typeof v !== 'object' || Array.isArray(v)) return 'invalid'
      return v as Record<string, unknown>
    } catch {
      return 'invalid'
    }
  }

  async function runPreview(): Promise<void> {
    const name = indexName.trim()
    if (!validIndexName(name)) {
      setError('Index name must be lowercase and free of \\ / * ? " < > | space , #')
      return
    }
    const parsed = parseOverrides()
    if (parsed === 'invalid') {
      setError('Overrides must be a JSON object, e.g. {"aliases": {...}}')
      return
    }
    setPreviewing(true)
    setError(null)
    try {
      const res = await api.simulateIndexTemplate(connectionId, templateName, name)
      setPreview(res)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setPreviewing(false)
    }
  }

  async function runCreate(): Promise<void> {
    const name = indexName.trim()
    if (!validIndexName(name)) {
      setError('Index name must be lowercase and free of \\ / * ? " < > | space , #')
      return
    }
    const parsed = parseOverrides()
    if (parsed === 'invalid') {
      setError('Overrides must be a JSON object, e.g. {"aliases": {...}}')
      return
    }
    setRunning(true)
    setError(null)
    try {
      await api.createIndexFromTemplate(connectionId, name, parsed)
      setCreated(true)
      onCreated()
      window.setTimeout(onClose, 600)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal create-index-modal">
        <h2>Create index from template "{templateName}"</h2>

        <div className="field">
          <span>Index name</span>
          <input
            className="input mono"
            autoFocus
            placeholder="e.g. logs-2026.09.30"
            value={indexName}
            onChange={(e) => setIndexName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void runCreate()
              if (e.key === 'Escape') onClose()
            }}
          />
        </div>

        <div className="field">
          <span>Overrides (optional JSON: aliases, settings, mappings)</span>
          <JsonEditor
            value={overrides}
            onChange={setOverrides}
            placeholder={'{"aliases": {...}, "settings": {...}}'}
            minHeight="120px"
          />
        </div>

        {error && <div className="banner banner-error">{error}</div>}
        {created && <div className="banner banner-ok">Index created</div>}

        {preview && (
          <div className="create-index-preview">
            <div className="settings-section-heading">Simulated result</div>
            <pre className="json">
              <JsonView value={preview} />
            </pre>
          </div>
        )}

        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={running}>
            {created ? 'Close' : 'Cancel'}
          </button>
          <button className="btn" onClick={() => void runPreview()} disabled={previewing || running}>
            {previewing ? 'Previewing…' : 'Preview'}
          </button>
          <button className="btn btn-primary" onClick={() => void runCreate()} disabled={running}>
            {running ? 'Creating…' : 'Create index'}
          </button>
        </div>
      </div>
    </div>
  )
}

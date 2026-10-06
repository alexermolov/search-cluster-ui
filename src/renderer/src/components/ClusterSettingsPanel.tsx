import { useEffect, useState } from 'react'
import type { ClusterSettings } from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../store'
import { JsonEditor } from './JsonEditor'

/**
 * Cluster settings viewer/editor: persistent + transient blocks, edited as
 * JSON. Empty object = no settings of that kind; null value = reset to
 * default (sent as null per key).
 */
export function ClusterSettingsPanel() {
  const activeId = useApp((s) => s.activeId)
  const [settings, setSettings] = useState<ClusterSettings | null>(null)
  const [persistent, setPersistent] = useState('{}')
  const [transient, setTransient] = useState('{}')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (!activeId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSettings(null)

    api
      .fetchClusterSettings(activeId)
      .then((r) => {
        if (cancelled) return
        setSettings(r)
        setPersistent(JSON.stringify(r.persistent, null, 2))
        setTransient(JSON.stringify(r.transient, null, 2))
      })
      .catch((e) => !cancelled && setError(errorMessage(e)))
      .finally(() => !cancelled && setLoading(false))

    return () => {
      cancelled = true
    }
  }, [activeId, reloadTick])

  function parseBlock(text: string): Record<string, unknown> | null | 'invalid' {
    const trimmed = text.trim()
    if (trimmed === '') return null
    try {
      const v: unknown = JSON.parse(trimmed)
      if (v === null) return null
      if (typeof v !== 'object' || Array.isArray(v)) return 'invalid'
      return v as Record<string, unknown>
    } catch {
      return 'invalid'
    }
  }

  async function save(): Promise<void> {
    if (!activeId) return
    const p = parseBlock(persistent)
    if (p === 'invalid') {
      setError('Persistent settings are not valid JSON (must be an object)')
      return
    }
    const t = parseBlock(transient)
    if (t === 'invalid') {
      setError('Transient settings are not valid JSON (must be an object)')
      return
    }

    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const r = await api.updateClusterSettings(activeId, {
        persistent: p,
        transient: t,
      })
      setSettings(r)
      setPersistent(JSON.stringify(r.persistent, null, 2))
      setTransient(JSON.stringify(r.transient, null, 2))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="settings-panel">
      <div className="toolbar">
        <span className="muted">Persistent and transient cluster settings (PUT /_cluster/settings)</span>
        <span className="spacer" />
        <button className="btn" onClick={() => setReloadTick((t) => t + 1)} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {saved && <div className="banner banner-ok">Settings updated</div>}

      {loading && !settings && !error && <div className="loading">Loading settings…</div>}

      {settings && (
        <>
          <div className="settings-section">
            <div className="settings-section-heading">Persistent</div>
            <JsonEditor value={persistent} onChange={setPersistent} minHeight="140px" />
          </div>

          <div className="settings-section">
            <div className="settings-section-heading">Transient</div>
            <JsonEditor value={transient} onChange={setTransient} minHeight="140px" />
          </div>

          <div className="settings-actions">
            <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </button>
            <span className="settings-note">
              Set a key to <span className="mono">null</span> to reset it to the default value.
              Transient settings are lost on cluster restart.
            </span>
          </div>
        </>
      )}
    </div>
  )
}

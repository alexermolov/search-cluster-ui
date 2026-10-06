import { useState } from 'react'
import type { SaveConnectionInput } from '../../../shared/ipc'
import type {
  AuthConfig,
  ClusterFlavor,
  StoredConnection,
} from '../../../shared/types'
import { api, errorMessage } from '../api'
import { useApp } from '../store'

interface Props {
  connection: StoredConnection | null
}

const DEFAULT_DRAFT: Omit<SaveConnectionInput, 'id'> = {
  name: '',
  url: 'http://localhost:9200',
  flavor: 'opensearch',
  auth: { kind: 'basic', username: 'admin', password: '' },
  tlsVerify: true,
  timeoutMs: 10_000,
}

function toDraft(c: StoredConnection | null): SaveConnectionInput {
  if (!c) return { ...DEFAULT_DRAFT, auth: { ...DEFAULT_DRAFT.auth } }
  const { createdAt: _ct, updatedAt: _ut, ...rest } = c
  return { ...rest, auth: { ...c.auth } }
}

function emptyAuth(kind: AuthConfig['kind'], prev: AuthConfig): AuthConfig {
  const p = prev as Record<string, unknown>
  switch (kind) {
    case 'none':
      return { kind }
    case 'basic':
      return { kind, username: String(p.username ?? ''), password: String(p.password ?? '') }
    case 'bearer':
      return { kind, token: String(p.token ?? '') }
    case 'aws':
      return {
        kind,
        accessKeyId: String(p.accessKeyId ?? ''),
        secretAccessKey: String(p.secretAccessKey ?? ''),
        sessionToken: String(p.sessionToken ?? ''),
        region: String(p.region ?? 'us-east-1'),
        service: String(p.service ?? 'es'),
      }
  }
}

export function ConnectionForm({ connection }: Props) {
  const close = useApp((s) => s.closeEditor)
  const save = useApp((s) => s.saveConnection)

  const [draft, setDraft] = useState<SaveConnectionInput>(() => toDraft(connection))
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const patch = (p: Partial<SaveConnectionInput>) => setDraft((d) => ({ ...d, ...p }))
  const patchAuth = (p: Partial<AuthConfig>) =>
    setDraft((d) => ({ ...d, auth: { ...d.auth, ...p } as AuthConfig }))

  const auth = draft.auth

  async function test(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      const info = await api.testConnection(draft)
      setTestResult(`OK — ${info.distribution} ${info.version} (${info.clusterName})`)
    } catch (e) {
      setTestResult(`Failed: ${errorMessage(e)}`)
    } finally {
      setTesting(false)
    }
  }

  async function submit(): Promise<void> {
    if (!draft.name.trim()) return setError('Name is required')
    try {
      new URL(draft.url)
    } catch {
      return setError('URL is invalid (expected e.g. https://localhost:9200)')
    }
    setSaving(true)
    setError(null)
    try {
      await save(draft)
      close()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="modal">
        <h2>{connection ? 'Edit connection' : 'New connection'}</h2>

        <div className="field-row">
          <label className="field">
            <span>Name</span>
            <input
              className="input"
              autoFocus
              placeholder="Local OpenSearch"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          <label className="field">
            <span>URL</span>
            <input
              className="input mono"
              placeholder="https://localhost:9200"
              value={draft.url}
              onChange={(e) => patch({ url: e.target.value })}
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Flavor</span>
            <select
              className="input"
              value={draft.flavor}
              onChange={(e) => patch({ flavor: e.target.value as ClusterFlavor })}
            >
              <option value="opensearch">OpenSearch</option>
              <option value="elasticsearch">Elasticsearch</option>
            </select>
          </label>
          <label className="field">
            <span>Auth</span>
            <select
              className="input"
              value={auth.kind}
              onChange={(e) => patch({ auth: emptyAuth(e.target.value as AuthConfig['kind'], auth) })}
            >
              <option value="basic">Basic</option>
              <option value="bearer">API key / Bearer</option>
              <option value="aws">AWS SigV4</option>
              <option value="none">None</option>
            </select>
          </label>
        </div>

        {auth.kind === 'basic' && (
          <div className="field-row">
            <label className="field">
              <span>Username</span>
              <input
                className="input"
                value={auth.username}
                onChange={(e) => patchAuth({ username: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                className="input"
                type="password"
                value={auth.password}
                onChange={(e) => patchAuth({ password: e.target.value })}
              />
            </label>
          </div>
        )}

        {auth.kind === 'bearer' && (
          <label className="field">
            <span>API key / token (sent as: Bearer …)</span>
            <input
              className="input mono"
              type="password"
              value={auth.token}
              onChange={(e) => patchAuth({ token: e.target.value })}
            />
          </label>
        )}

        {auth.kind === 'aws' && (
          <>
            <div className="field-row">
              <label className="field">
                <span>Access key ID</span>
                <input
                  className="input mono"
                  value={auth.accessKeyId}
                  onChange={(e) => patchAuth({ accessKeyId: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Secret access key</span>
                <input
                  className="input mono"
                  type="password"
                  value={auth.secretAccessKey}
                  onChange={(e) => patchAuth({ secretAccessKey: e.target.value })}
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Session token (optional)</span>
                <input
                  className="input mono"
                  type="password"
                  value={auth.sessionToken ?? ''}
                  onChange={(e) => patchAuth({ sessionToken: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Region</span>
                <input
                  className="input mono"
                  placeholder="us-east-1"
                  value={auth.region}
                  onChange={(e) => patchAuth({ region: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Service</span>
                <select
                  className="input"
                  value={auth.service ?? 'es'}
                  onChange={(e) => patchAuth({ service: e.target.value })}
                >
                  <option value="es">es (managed)</option>
                  <option value="aoss">aoss (serverless)</option>
                </select>
              </label>
            </div>
          </>
        )}

        <div className="field-row">
          <label className="field checkbox">
            <input
              type="checkbox"
              checked={draft.tlsVerify}
              onChange={(e) => patch({ tlsVerify: e.target.checked })}
            />
            Verify TLS certificates
          </label>
          <label className="field">
            <span>Timeout, ms</span>
            <input
              className="input"
              type="number"
              min={1000}
              step={1000}
              value={draft.timeoutMs}
              onChange={(e) => patch({ timeoutMs: Number(e.target.value) || 10_000 })}
            />
          </label>
        </div>

        {testResult && (
          <div className={`banner ${testResult.startsWith('OK') ? 'banner-ok' : 'banner-error'}`}>
            {testResult}
          </div>
        )}
        {error && <div className="banner banner-error">{error}</div>}

        <div className="modal-footer">
          <button className="btn" onClick={() => void test()} disabled={testing}>
            {testing ? 'Testing…' : 'Test'}
          </button>
          <div className="spacer" />
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

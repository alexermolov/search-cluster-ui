import { useEffect, useRef, useState } from 'react'
import type {
  RedisKeyDetail,
  RedisKeyEntry,
  RedisKeyType,
  RedisServerInfo,
  StoredRedisConnection,
} from '../../../shared/types'
import type { RedisConnectionInput, RedisKeySaveInput } from '../../../shared/types'
import { api, errorMessage } from '../api'

const REDIS_MAX_LOADED_KEYS = 5000
const REDIS_KEY_ROW_HEIGHT = 56
const REDIS_KEY_OVERSCAN = 5

function mergeKeyPages(previous: RedisKeyEntry[], next: RedisKeyEntry[]): RedisKeyEntry[] {
  const fresh = [...new Map(next.map((entry) => [entry.key, entry])).values()]
    .sort((a, b) => a.key.localeCompare(b.key))
  const merged: RedisKeyEntry[] = []
  let oldIndex = 0
  let newIndex = 0
  while (oldIndex < previous.length && newIndex < fresh.length) {
    const oldEntry = previous[oldIndex]
    const newEntry = fresh[newIndex]
    if (oldEntry.key.localeCompare(newEntry.key) < 0) {
      merged.push(oldEntry)
      oldIndex += 1
    } else if (oldEntry.key.localeCompare(newEntry.key) > 0) {
      merged.push(newEntry)
      newIndex += 1
    } else {
      merged.push(newEntry)
      oldIndex += 1
      newIndex += 1
    }
  }
  merged.push(...previous.slice(oldIndex), ...fresh.slice(newIndex))
  return merged.slice(0, REDIS_MAX_LOADED_KEYS)
}

function formatUptime(seconds: number | null): string {
  if (seconds === null) return '—'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

const EMPTY_TLS = {
  enabled: false,
  rejectUnauthorized: true,
  ca: '',
  cert: '',
  key: '',
}

const NEW_CONNECTION: RedisConnectionInput = {
  name: '',
  topology: 'standalone',
  host: 'localhost',
  port: 6379,
  db: 0,
  nodes: 'localhost:6379',
  masterName: 'mymaster',
  username: '',
  password: '',
  sentinelUsername: '',
  sentinelPassword: '',
  tls: EMPTY_TLS,
  timeoutMs: 10_000,
}

const REDIS_COMMANDS = [
  ['APPEND', 'APPEND key value'],
  ['AUTH', 'AUTH password'],
  ['BITCOUNT', 'BITCOUNT key [start end]'],
  ['CLIENT', 'CLIENT subcommand'],
  ['DBSIZE', 'DBSIZE'],
  ['DECR', 'DECR key'],
  ['DEL', 'DEL key [key ...]'],
  ['EXISTS', 'EXISTS key [key ...]'],
  ['EXPIRE', 'EXPIRE key seconds'],
  ['EXPIREAT', 'EXPIREAT key timestamp'],
  ['FLUSHDB', 'FLUSHDB'],
  ['GET', 'GET key'],
  ['GETDEL', 'GETDEL key'],
  ['GETEX', 'GETEX key [EX seconds]'],
  ['GETRANGE', 'GETRANGE key start end'],
  ['HDEL', 'HDEL key field [field ...]'],
  ['HEXISTS', 'HEXISTS key field'],
  ['HGET', 'HGET key field'],
  ['HGETALL', 'HGETALL key'],
  ['HKEYS', 'HKEYS key'],
  ['HMGET', 'HMGET key field [field ...]'],
  ['HMSET', 'HMSET key field value [field value ...]'],
  ['HSET', 'HSET key field value [field value ...]'],
  ['HVALS', 'HVALS key'],
  ['INCR', 'INCR key'],
  ['INFO', 'INFO [section]'],
  ['KEYS', 'KEYS pattern'],
  ['LLEN', 'LLEN key'],
  ['LPOP', 'LPOP key [count]'],
  ['LPUSH', 'LPUSH key element [element ...]'],
  ['LRANGE', 'LRANGE key start stop'],
  ['PING', 'PING [message]'],
  ['PUBLISH', 'PUBLISH channel message'],
  ['PTTL', 'PTTL key'],
  ['RENAME', 'RENAME key newkey'],
  ['RPOP', 'RPOP key [count]'],
  ['RPUSH', 'RPUSH key element [element ...]'],
  ['SCAN', 'SCAN cursor [MATCH pattern] [COUNT count]'],
  ['SET', 'SET key value [EX seconds] [NX|XX]'],
  ['SADD', 'SADD key member [member ...]'],
  ['SCARD', 'SCARD key'],
  ['SISMEMBER', 'SISMEMBER key member'],
  ['SMEMBERS', 'SMEMBERS key'],
  ['SREM', 'SREM key member [member ...]'],
  ['STRLEN', 'STRLEN key'],
  ['TTL', 'TTL key'],
  ['TYPE', 'TYPE key'],
  ['UNLINK', 'UNLINK key [key ...]'],
  ['ZADD', 'ZADD key score member [score member ...]'],
  ['ZCARD', 'ZCARD key'],
  ['ZRANGE', 'ZRANGE key start stop [WITHSCORES]'],
  ['ZREM', 'ZREM key member [member ...]'],
] as const

interface ConnectionFormProps {
  connection: StoredRedisConnection | null
  onClose: () => void
  onSave: (input: RedisConnectionInput) => Promise<void>
}

function RedisConnectionForm({ connection, onClose, onSave }: ConnectionFormProps) {
  const [draft, setDraft] = useState<RedisConnectionInput>(() =>
    connection
      ? {
          ...connection,
          tls: { ...connection.tls },
        }
      : { ...NEW_CONNECTION, tls: { ...EMPTY_TLS } },
  )
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function test(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      const info = await api.testRedisConnection(draft)
      setTestResult(`Connected · Redis ${info.version} · ${info.mode}${info.role ? ` · ${info.role}` : ''}`)
    } catch (reason) {
      setTestResult(`Failed: ${errorMessage(reason)}`)
    } finally {
      setTesting(false)
    }
  }

  async function submit(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await onSave(draft)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal redis-connection-modal">
        <h2>{connection ? 'Edit Redis connection' : 'New Redis connection'}</h2>
        <div className="field-row">
          <label className="field">
            <span>Name</span>
            <input
              className="input"
              autoFocus
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Local Redis"
            />
          </label>
          <label className="field">
            <span>Topology</span>
            <select
              className="input"
              value={draft.topology}
              onChange={(event) => {
                const topology = event.target.value
                if (topology === 'standalone' || topology === 'cluster' || topology === 'sentinel')
                  setDraft({ ...draft, topology })
              }}
            >
              <option value="standalone">Standalone</option>
              <option value="cluster">Redis Cluster</option>
              <option value="sentinel">Sentinel</option>
            </select>
          </label>
        </div>

        {draft.topology === 'standalone' ? (
          <div className="field-row">
            <label className="field">
              <span>Host</span>
              <input
                className="input mono"
                value={draft.host}
                onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                placeholder="localhost"
              />
            </label>
            <label className="field">
              <span>Port</span>
              <input
                className="input"
                type="number"
                min={1}
                max={65535}
                value={draft.port}
                onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) })}
              />
            </label>
            <label className="field">
              <span>Database</span>
              <input
                className="input"
                type="number"
                min={0}
                value={draft.db}
                onChange={(event) => setDraft({ ...draft, db: Number(event.target.value) })}
              />
            </label>
          </div>
        ) : (
          <>
            <label className="field">
              <span>{draft.topology === 'cluster' ? 'Cluster nodes' : 'Sentinel nodes'} (host:port, comma-separated)</span>
              <input
                className="input mono"
                value={draft.nodes}
                onChange={(event) => setDraft({ ...draft, nodes: event.target.value })}
                placeholder="redis-1:6379,redis-2:6379"
              />
            </label>
            {draft.topology === 'sentinel' && (
              <div className="field-row">
                <label className="field">
                  <span>Master name</span>
                  <input
                    className="input mono"
                    value={draft.masterName}
                    onChange={(event) => setDraft({ ...draft, masterName: event.target.value })}
                    placeholder="mymaster"
                  />
                </label>
                <label className="field">
                  <span>Database</span>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    value={draft.db}
                    onChange={(event) => setDraft({ ...draft, db: Number(event.target.value) })}
                  />
                </label>
              </div>
            )}
          </>
        )}

        <div className="field-row">
          <label className="field">
            <span>ACL username (optional)</span>
            <input
              className="input"
              value={draft.username}
              onChange={(event) => setDraft({ ...draft, username: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Password (optional)</span>
            <input
              className="input"
              type="password"
              value={draft.password}
              onChange={(event) => setDraft({ ...draft, password: event.target.value })}
            />
          </label>
        </div>
        {draft.topology === 'sentinel' && (
          <div className="field-row">
            <label className="field">
              <span>Sentinel username (optional)</span>
              <input
                className="input"
                value={draft.sentinelUsername}
                onChange={(event) => setDraft({ ...draft, sentinelUsername: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Sentinel password (optional)</span>
              <input
                className="input"
                type="password"
                value={draft.sentinelPassword}
                onChange={(event) => setDraft({ ...draft, sentinelPassword: event.target.value })}
              />
            </label>
          </div>
        )}
        <div className="field-row">
          <label className="field">
            <span>Timeout, ms</span>
            <input
              className="input"
              type="number"
              min={1000}
              step={1000}
              value={draft.timeoutMs}
              onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) })}
            />
          </label>
          <div className="field redis-tls-toggle">
            <span>TLS / SSL</span>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.tls.enabled}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    tls: { ...draft.tls, enabled: event.target.checked },
                  })
                }
              />
              Encrypt connection
            </label>
          </div>
        </div>
        {draft.tls.enabled && (
          <>
            <label className="field checkbox">
              <input
                type="checkbox"
                checked={draft.tls.rejectUnauthorized}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    tls: { ...draft.tls, rejectUnauthorized: event.target.checked },
                  })
                }
              />
              Verify server certificate
            </label>
            <div className="field-row">
              <label className="field">
                <span>CA certificate (PEM, optional)</span>
                <textarea
                  className="input redis-pem"
                  value={draft.tls.ca}
                  onChange={(event) =>
                    setDraft({ ...draft, tls: { ...draft.tls, ca: event.target.value } })
                  }
                />
              </label>
              <label className="field">
                <span>Client certificate and private key (optional)</span>
                <textarea
                  className="input redis-pem"
                  value={draft.tls.cert}
                  onChange={(event) =>
                    setDraft({ ...draft, tls: { ...draft.tls, cert: event.target.value } })
                  }
                  placeholder="Add a client certificate and private key in the connection profile."
                />
              </label>
            </div>
            <label className="field">
              <span>Client private key (PEM, optional)</span>
              <textarea
                className="input redis-pem"
                value={draft.tls.key}
                onChange={(event) =>
                  setDraft({ ...draft, tls: { ...draft.tls, key: event.target.value } })
                }
              />
            </label>
          </>
        )}

        {testResult && (
          <div className={`banner ${testResult.startsWith('Connected') ? 'banner-ok' : 'banner-error'}`}>
            {testResult}
          </div>
        )}
        {error && <div className="banner banner-error">{error}</div>}
        <div className="modal-footer">
          <button className="btn" onClick={() => void test()} disabled={testing}>
            {testing ? 'Testing…' : 'Test'}
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

interface KeyEditorState {
  key: string
  type: Exclude<RedisKeyType, 'stream' | 'other'>
  value: string
  ttlMs: number
}

interface KeyEditorProps {
  initial: KeyEditorState
  onClose: () => void
  onSave: (input: RedisKeySaveInput) => Promise<void>
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === 'string')
  )
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isSortedSet(value: unknown): value is Array<{ member: string; score: number }> {
  return (
    Array.isArray(value) &&
    value.every(
      (item): item is { member: string; score: number } =>
        typeof item === 'object' &&
        item !== null &&
        typeof item.member === 'string' &&
        typeof item.score === 'number',
    )
  )
}

function parseKeyInput(draft: KeyEditorState): RedisKeySaveInput {
  const value: unknown = JSON.parse(draft.value)
  switch (draft.type) {
    case 'string':
      if (typeof value !== 'string') throw new Error('String values must be JSON strings')
      return { key: draft.key, type: draft.type, value, ttlMs: draft.ttlMs }
    case 'hash':
      if (!isStringRecord(value))
        throw new Error('Hash values must be a JSON object of string field/value pairs')
      return { key: draft.key, type: draft.type, value, ttlMs: draft.ttlMs }
    case 'list':
    case 'set':
      if (!isStringArray(value)) throw new Error(`${draft.type} values must be a JSON array of strings`)
      return { key: draft.key, type: draft.type, value, ttlMs: draft.ttlMs }
    case 'zset':
      if (!isSortedSet(value))
        throw new Error('Sorted set values must be a JSON array of {member, score} objects')
      return { key: draft.key, type: draft.type, value, ttlMs: draft.ttlMs }
  }
}

function RedisKeyEditor({ initial, onClose, onSave }: KeyEditorProps) {
  const [draft, setDraft] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await onSave(parseKeyInput(draft))
      onClose()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal redis-key-modal">
        <h2>{initial.key ? `Edit key · ${initial.key}` : 'Create Redis key'}</h2>
        <div className="field-row">
          <label className="field">
            <span>Key</span>
            <input
              className="input mono"
              autoFocus
              value={draft.key}
              onChange={(event) => setDraft({ ...draft, key: event.target.value })}
              disabled={Boolean(initial.key)}
            />
          </label>
          <label className="field">
            <span>Type</span>
            <select
              className="input"
              value={draft.type}
              disabled={Boolean(initial.key)}
              onChange={(event) => {
                const type = event.target.value
                if (
                  type !== 'string' &&
                  type !== 'hash' &&
                  type !== 'list' &&
                  type !== 'set' &&
                  type !== 'zset'
                )
                  return
                const value = type === 'string' ? '""' : type === 'hash' ? '{}' : '[]'
                setDraft({ ...draft, type, value })
              }}
            >
              <option value="string">String</option>
              <option value="hash">Hash</option>
              <option value="list">List</option>
              <option value="set">Set</option>
              <option value="zset">Sorted set</option>
            </select>
          </label>
          <label className="field redis-ttl-field">
            <span>TTL, ms (-1 = no expiry)</span>
            <input
              className="input"
              type="number"
              min={-1}
              step={1000}
              value={draft.ttlMs}
              onChange={(event) => setDraft({ ...draft, ttlMs: Number(event.target.value) })}
            />
          </label>
        </div>
        <label className="field">
          <span>Value (JSON)</span>
          <textarea
            className="input redis-value-editor"
            value={draft.value}
            onChange={(event) => setDraft({ ...draft, value: event.target.value })}
            spellCheck={false}
          />
        </label>
        <div className="muted redis-editor-hint">
          Use a string for String, an object for Hash, an array of strings for List/Set, or
          {" "}an array of {"{ member, score }"} for Sorted set.
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={saving}>
            {saving ? 'Saving…' : 'Save key'}
          </button>
        </div>
      </div>
    </div>
  )
}

type RedisTab = 'keys' | 'console' | 'server'

function formatTtl(ttlMs: number): string {
  if (ttlMs === -1) return 'Persistent'
  if (ttlMs === -2) return 'Expired'
  if (ttlMs < 1000) return `${ttlMs} ms`
  return `${(ttlMs / 1000).toFixed(1)} s`
}

function connectionAddress(connection: StoredRedisConnection): string {
  if (connection.topology === 'standalone') return `${connection.host}:${connection.port} · DB ${connection.db}`
  if (connection.topology === 'sentinel')
    return `sentinel · ${connection.nodes} · ${connection.masterName} · DB ${connection.db}`
  return `${connection.topology} · ${connection.nodes}`
}

function serverLabel(value: string | null): string {
  return value ?? '—'
}

export function RedisWorkspace({ onClose }: { onClose: () => void }) {
  const [connections, setConnections] = useState<StoredRedisConnection[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [tab, setTab] = useState<RedisTab>('keys')
  const [keys, setKeys] = useState<Array<{ key: string; type: RedisKeyType; ttlMs: number }>>([])
  const [keyPattern, setKeyPattern] = useState('')
  const [scanMatch, setScanMatch] = useState('*')
  const [cursor, setCursor] = useState('')
  const [selectedKey, setSelectedKey] = useState<RedisKeyDetail | null>(null)
  const [server, setServer] = useState<RedisServerInfo | null>(null)
  const [command, setCommand] = useState('')
  const [activeCommandSuggestion, setActiveCommandSuggestion] = useState(0)
  const [commandSuggestionsDismissed, setCommandSuggestionsDismissed] = useState(false)
  const [commandOutput, setCommandOutput] = useState<Array<{ command: string; result: unknown; error?: string }>>([])
  const [keyListWindow, setKeyListWindow] = useState({ top: 0, height: 600 })
  const [loadingKeys, setLoadingKeys] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingServer, setLoadingServer] = useState(false)
  const [runningCommand, setRunningCommand] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<KeyEditorState | null>(null)
  const [connectionEditor, setConnectionEditor] = useState<StoredRedisConnection | null | undefined>(undefined)
  const keyRequest = useRef(0)
  const detailRequest = useRef(0)
  const serverRequest = useRef(0)
  const keyListRef = useRef<HTMLDivElement>(null)
  const commandInput = useRef<HTMLInputElement>(null)

  const active = connections.find((connection) => connection.id === activeId) ?? null
  const firstVisibleKey = Math.max(
    0,
    Math.floor(keyListWindow.top / REDIS_KEY_ROW_HEIGHT) - REDIS_KEY_OVERSCAN,
  )
  const lastVisibleKey = Math.min(
    keys.length,
    firstVisibleKey + Math.ceil(keyListWindow.height / REDIS_KEY_ROW_HEIGHT) + REDIS_KEY_OVERSCAN * 2,
  )
  const visibleKeys = keys.slice(firstVisibleKey, lastVisibleKey)
  const commandPrefix = command.match(/^\s*(\S+)$/)?.[1] ?? null
  const commandSuggestions = commandPrefix && !commandSuggestionsDismissed
    ? REDIS_COMMANDS.filter(([name]) => name.startsWith(commandPrefix.toUpperCase())).slice(0, 8)
    : []

  useEffect(() => {
    if (tab !== 'keys' || !keyListRef.current) return
    keyListRef.current.scrollTop = 0
    setKeyListWindow({ top: 0, height: keyListRef.current.clientHeight })
  }, [tab])

  function completeCommand(name: string): void {
    const leadingWhitespace = command.match(/^\s*/)?.[0] ?? ''
    const completed = `${leadingWhitespace}${name} `
    setCommand(completed)
    setActiveCommandSuggestion(0)
    setCommandSuggestionsDismissed(false)
    requestAnimationFrame(() => {
      commandInput.current?.focus()
      commandInput.current?.setSelectionRange(completed.length, completed.length)
    })
  }

  async function reloadKeys(connectionId: string, append = false, filter = keyPattern): Promise<void> {
    const request = ++keyRequest.current
    const pattern = filter.trim()
    const match = append
      ? scanMatch
      : pattern
        ? pattern.includes('*') || pattern.includes('?')
          ? pattern
          : `*${pattern}*`
        : '*'
    const requestCursor = append ? cursor : ''
    setLoadingKeys(true)
    setError(null)
    if (!append) {
      setScanMatch(match)
      setKeys([])
      setCursor('')
      setKeyListWindow({ top: 0, height: keyListRef.current?.clientHeight ?? 600 })
      if (keyListRef.current) keyListRef.current.scrollTop = 0
      setSelectedKey(null)
      detailRequest.current += 1
    }
    try {
      const result = await api.scanRedisKeys(connectionId, {
        pattern: match,
        cursor: requestCursor,
        count: 200,
      })
      if (request !== keyRequest.current) return
      setKeys((previous) => {
        if (!append) return result.keys
        return mergeKeyPages(previous, result.keys)
      })
      setCursor(result.cursor)
    } catch (reason) {
      if (request === keyRequest.current) setError(errorMessage(reason))
    } finally {
      if (request === keyRequest.current) setLoadingKeys(false)
    }
  }

  async function loadServer(connectionId: string): Promise<void> {
    const request = ++serverRequest.current
    setLoadingServer(true)
    try {
      const result = await api.fetchRedisServerInfo(connectionId)
      if (request === serverRequest.current) setServer(result)
    } catch (reason) {
      if (request === serverRequest.current) setError(errorMessage(reason))
    } finally {
      if (request === serverRequest.current) setLoadingServer(false)
    }
  }

  async function activate(connectionId: string): Promise<void> {
    keyRequest.current += 1
    detailRequest.current += 1
    serverRequest.current += 1
    setActiveId(connectionId)
    setTab('keys')
    setServer(null)
    setSelectedKey(null)
    setCommandOutput([])
    await Promise.all([reloadKeys(connectionId), loadServer(connectionId)])
  }

  useEffect(() => {
    void api.listRedisConnections().then((items) => {
      setConnections(items)
      if (items[0]) {
        setActiveId(items[0].id)
        void reloadKeys(items[0].id)
        void loadServer(items[0].id)
      }
    }).catch((reason: unknown) => setError(errorMessage(reason)))
  }, [])

  async function saveConnection(input: RedisConnectionInput): Promise<void> {
    const saved = await api.saveRedisConnection(input)
    const next = await api.listRedisConnections()
    setConnections(next)
    setConnectionEditor(undefined)
    await activate(saved.id)
  }

  async function removeConnection(connection: StoredRedisConnection): Promise<void> {
    if (!window.confirm(`Delete Redis connection "${connection.name}"?`)) return
    try {
      await api.deleteRedisConnection(connection.id)
      const next = await api.listRedisConnections()
      setConnections(next)
      if (activeId === connection.id) {
        if (next[0]) await activate(next[0].id)
        else {
          keyRequest.current += 1
          detailRequest.current += 1
          serverRequest.current += 1
          setActiveId(null)
          setKeys([])
          setSelectedKey(null)
          setServer(null)
        }
      }
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  async function selectKey(key: string): Promise<void> {
    if (!active) return
    const request = ++detailRequest.current
    setLoadingDetail(true)
    setError(null)
    try {
      const detail = await api.getRedisKey(active.id, key)
      if (request === detailRequest.current) setSelectedKey(detail)
    } catch (reason) {
      if (request === detailRequest.current) setError(errorMessage(reason))
    } finally {
      if (request === detailRequest.current) setLoadingDetail(false)
    }
  }

  async function saveKey(input: RedisKeySaveInput): Promise<void> {
    if (!active) return
    await api.saveRedisKey(active.id, input)
    setEditor(null)
    await reloadKeys(active.id)
    await selectKey(input.key)
  }

  async function deleteKey(key: string): Promise<void> {
    if (!active || !window.confirm(`Delete Redis key "${key}"?`)) return
    try {
      await api.deleteRedisKey(active.id, key)
      setSelectedKey(null)
      await reloadKeys(active.id)
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  async function executeCommand(): Promise<void> {
    if (!active || !command.trim()) return
    const submitted = command
    setRunningCommand(true)
    setError(null)
    try {
      const result = await api.runRedisCommand(active.id, submitted)
      setCommandOutput((previous) => [...previous, { command: submitted, result }].slice(-100))
    } catch (reason) {
      const message = errorMessage(reason)
      setCommandOutput((previous) =>
        [...previous, { command: submitted, result: null, error: message }].slice(-100),
      )
    } finally {
      setRunningCommand(false)
    }
  }

  return (
    <div className="app">
      <aside className="sidebar redis-sidebar">
        <div className="sidebar-header">
          <span className="logo">◈</span> Redis Browser
        </div>
        <button className="btn btn-block" onClick={onClose}>← Product selection</button>
        <div className="sidebar-label">Redis connections</div>
        <div className="conn-list">
          {connections.map((connection) => (
            <div
              key={connection.id}
              className={`conn-item${connection.id === activeId ? ' active' : ''}`}
              onClick={() => void activate(connection.id)}
            >
              <span className={`dot dot-${connection.id === activeId ? 'green' : 'unknown'}`} />
              <div className="conn-meta">
                <div className="conn-name">{connection.name}</div>
                <div className="conn-url">{connectionAddress(connection)}</div>
              </div>
              <div className="conn-actions">
                <button
                  title="Edit"
                  onClick={(event) => {
                    event.stopPropagation()
                    setConnectionEditor(connection)
                  }}
                >
                  ✎
                </button>
                <button
                  title="Delete"
                  onClick={(event) => {
                    event.stopPropagation()
                    void removeConnection(connection)
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          {connections.length === 0 && <div className="conn-empty">No Redis connections</div>}
        </div>
        <button className="btn btn-primary btn-block" onClick={() => setConnectionEditor(null)}>
          + Add Redis connection
        </button>
      </aside>

      <main className="workspace redis-workspace">
        <header className="ws-header">
          <div className="ws-header-title">
            <h1 className="ws-title">{active?.name ?? 'Redis'}</h1>
            <div className="ws-sub">
              {active ? connectionAddress(active) : 'Connect to Redis to browse and edit keys.'}
            </div>
          </div>
          {active && (
            <div className="ws-actions">
              <button
                className="btn"
                onClick={() => {
                  if (tab === 'keys') void reloadKeys(active.id)
                  else void loadServer(active.id)
                }}
                disabled={loadingKeys || loadingServer}
              >
                {loadingKeys || loadingServer ? 'Loading…' : 'Refresh'}
              </button>
            </div>
          )}
        </header>

        {error && <div className="banner banner-error redis-error">{error}</div>}
        {!active ? (
          <div className="empty-state redis-empty">
            <div className="empty-title">No Redis connection selected</div>
            <div>Add a standalone, Cluster, or Sentinel connection to get started.</div>
            <button className="btn btn-primary" onClick={() => setConnectionEditor(null)}>
              + Add Redis connection
            </button>
          </div>
        ) : (
          <>
            <nav className="redis-tabs" aria-label="Redis views">
              {(['keys', 'console', 'server'] as const).map((view) => (
                <button
                  key={view}
                  className={`redis-tab${tab === view ? ' active' : ''}`}
                  onClick={() => {
                    if (view === 'keys') setKeyListWindow((current) => ({ ...current, top: 0 }))
                    setTab(view)
                  }}
                >
                  {view === 'keys' ? 'Keys' : view === 'console' ? 'Console' : 'Server info'}
                </button>
              ))}
            </nav>

            {tab === 'keys' && (
              <div className="redis-browser">
                <section className="redis-key-browser">
                  <div className="redis-section-heading">
                    <h2>Keys</h2>
                    <span className="muted">{keys.length}</span>
                  </div>
                  <form
                    className="redis-key-search"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void reloadKeys(active.id, false, keyPattern)
                    }}
                  >
                    <input
                      className="input mono"
                      placeholder="Filter keys or pattern…"
                      value={keyPattern}
                      onChange={(event) => setKeyPattern(event.target.value)}
                    />
                    <button className="btn" type="submit" disabled={loadingKeys}>Search</button>
                  </form>
                  <div
                    className="redis-key-list"
                    ref={keyListRef}
                    onScroll={(event) =>
                      setKeyListWindow({
                        top: event.currentTarget.scrollTop,
                        height: event.currentTarget.clientHeight,
                      })
                    }
                  >
                    {keys.length > 0 && (
                      <div className="redis-key-list-window" style={{ height: keys.length * REDIS_KEY_ROW_HEIGHT }}>
                        {visibleKeys.map((entry, index) => {
                          const keyIndex = firstVisibleKey + index
                          return (
                            <button
                              key={entry.key}
                              className={`redis-key-item${selectedKey?.key === entry.key ? ' active' : ''}`}
                              style={{
                                position: 'absolute',
                                top: keyIndex * REDIS_KEY_ROW_HEIGHT,
                                height: REDIS_KEY_ROW_HEIGHT - 3,
                              }}
                              onClick={() => void selectKey(entry.key)}
                            >
                              <span className="redis-key-name">{entry.key}</span>
                              <span className="redis-key-meta">
                                <span>{entry.type}</span>
                                <span>{formatTtl(entry.ttlMs)}</span>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {!loadingKeys && keys.length === 0 && (
                      <div className="muted redis-empty-keys">No keys found for this pattern.</div>
                    )}
                  </div>
                  {keys.length >= REDIS_MAX_LOADED_KEYS && cursor && (
                    <div className="muted redis-key-limit">
                      Showing the first {REDIS_MAX_LOADED_KEYS.toLocaleString()} keys. Narrow the pattern to see more.
                    </div>
                  )}
                  <button
                    className="btn btn-block"
                    onClick={() => void reloadKeys(active.id, true)}
                    disabled={!cursor || loadingKeys || keys.length >= REDIS_MAX_LOADED_KEYS}
                  >
                    {loadingKeys ? 'Scanning…' : cursor ? 'Load more' : 'End of key scan'}
                  </button>
                  <button
                    className="btn btn-primary btn-block"
                    onClick={() =>
                      setEditor({ key: '', type: 'string', value: '""', ttlMs: -1 })
                    }
                  >
                    + Create key
                  </button>
                </section>

                <section className="redis-key-detail">
                  {!selectedKey ? (
                    <div className="empty-state">
                      <div className="empty-title">
                        {loadingDetail ? 'Loading key…' : 'Select a key'}
                      </div>
                      <div>Browse, inspect, and edit Redis values.</div>
                    </div>
                  ) : (
                    <>
                      <div className="redis-section-heading">
                        <div>
                          <h2 className="mono">{selectedKey.key}</h2>
                          <div className="muted">
                            {selectedKey.type} · {formatTtl(selectedKey.ttlMs)}
                          </div>
                        </div>
                        <div className="redis-detail-actions">
                          {selectedKey.type !== 'stream' && selectedKey.type !== 'other' && !selectedKey.truncated && (
                            <button
                              className="btn"
                              onClick={() => {
                                if (selectedKey.type === 'stream' || selectedKey.type === 'other') return
                                setEditor({
                                  key: selectedKey.key,
                                  type: selectedKey.type,
                                  value: JSON.stringify(selectedKey.value, null, 2),
                                  ttlMs: selectedKey.ttlMs,
                                })
                              }}
                            >
                              Edit
                            </button>
                          )}
                          <button className="btn btn-danger" onClick={() => void deleteKey(selectedKey.key)}>
                            Delete
                          </button>
                        </div>
                      </div>
                      {selectedKey.truncated && (
                        <div className="muted redis-key-limit">
                          {selectedKey.type === 'stream'
                            ? 'Only the first 100 stream entries are shown.'
                            : 'Only the first 1,000 collection values are shown; editing is disabled to preserve the remaining data.'}
                        </div>
                      )}
                      <pre className="redis-key-value">{JSON.stringify(selectedKey.value, null, 2)}</pre>
                    </>
                  )}
                </section>
              </div>
            )}

            {tab === 'console' && (
              <section className="redis-console">
                <div className="redis-section-heading">
                  <h2>Redis command console</h2>
                  <div className="redis-console-header-actions">
                    <button
                      className="btn"
                      onClick={() => setCommandOutput([])}
                      disabled={commandOutput.length === 0}
                    >
                      Clear output
                    </button>
                    <span className="muted">Commands run on the selected connection</span>
                  </div>
                </div>
                <form
                  className="redis-command-form"
                  onSubmit={(event) => {
                    event.preventDefault()
                    void executeCommand()
                  }}
                >
                  <div className="redis-command-editor">
                    <input
                      ref={commandInput}
                      type="text"
                      className="input mono redis-command-input"
                      value={command}
                      onChange={(event) => {
                        setCommand(event.target.value)
                        setActiveCommandSuggestion(0)
                        setCommandSuggestionsDismissed(false)
                      }}
                      onKeyDown={(event) => {
                        if (!commandSuggestions.length) return
                        if (event.key === 'ArrowDown') {
                          event.preventDefault()
                          setActiveCommandSuggestion((index) => (index + 1) % commandSuggestions.length)
                        } else if (event.key === 'ArrowUp') {
                          event.preventDefault()
                          setActiveCommandSuggestion(
                            (index) => (index - 1 + commandSuggestions.length) % commandSuggestions.length,
                          )
                        } else if (event.key === 'Tab' || event.key === 'Enter') {
                          event.preventDefault()
                          completeCommand(commandSuggestions[activeCommandSuggestion][0])
                        } else if (event.key === 'Escape') {
                          setCommandSuggestionsDismissed(true)
                        }
                      }}
                      placeholder="PING"
                      spellCheck={false}
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={commandSuggestions.length > 0}
                      aria-controls="redis-command-suggestions"
                    />
                    {commandSuggestions.length > 0 && (
                      <div className="redis-command-suggestions" id="redis-command-suggestions" role="listbox">
                        {commandSuggestions.map(([name, syntax], index) => (
                          <button
                            className={`redis-command-suggestion${index === activeCommandSuggestion ? ' active' : ''}`}
                            key={name}
                            type="button"
                            role="option"
                            aria-selected={index === activeCommandSuggestion}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => completeCommand(name)}
                          >
                            <span>{name}</span>
                            <span className="muted">{syntax}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="btn btn-primary" type="submit" disabled={runningCommand || !command.trim()}>
                    {runningCommand ? 'Running…' : 'Run'}
                  </button>
                </form>
                <div className="redis-command-history">
                  {commandOutput.map((entry, index) => (
                    <article className="redis-command-result" key={`${index}-${entry.command}`}>
                      <div className="redis-command-line"><span>{'>'}</span> {entry.command}</div>
                      <pre className={entry.error ? 'redis-command-error' : ''}>
                        {entry.error ?? JSON.stringify(entry.result, null, 2)}
                      </pre>
                    </article>
                  ))}
                  {commandOutput.length === 0 && (
                    <div className="muted redis-console-hint">
                      Enter a command such as PING, GET key, or INFO. Use quotes for arguments containing spaces.
                    </div>
                  )}
                </div>
              </section>
            )}

            {tab === 'server' && (
              <section className="redis-server">
                <div className="redis-section-heading">
                  <h2>Server info</h2>
                  <span className="muted">{loadingServer ? 'Refreshing…' : `Redis ${server?.version ?? '—'}`}</span>
                </div>
                {server && (
                  <>
                    <div className="redis-metrics">
                      <article><span>Mode</span><strong>{server.mode}{server.role ? ` · ${server.role}` : ''}</strong></article>
                      <article><span>Connected clients</span><strong>{server.connectedClients ?? '—'}</strong></article>
                      <article><span>Blocked clients</span><strong>{server.blockedClients ?? '—'}</strong></article>
                      <article><span>Used memory</span><strong>{serverLabel(server.usedMemory)}</strong></article>
                      <article><span>Memory RSS</span><strong>{serverLabel(server.usedMemoryRss)}</strong></article>
                      <article><span>Memory limit</span><strong>{serverLabel(server.maxmemory)}</strong></article>
                      <article><span>Maxmemory policy</span><strong>{server.maxmemoryPolicy ?? '—'}</strong></article>
                      <article><span>Uptime</span><strong>{formatUptime(server.uptimeSeconds)}</strong></article>
                      <article><span>Ops/sec</span><strong>{server.instantaneousOpsPerSec ?? '—'}</strong></article>
                      <article><span>Total commands</span><strong>{server.totalCommandsProcessed?.toLocaleString() ?? '—'}</strong></article>
                      <article><span>Expired keys</span><strong>{server.expiredKeys?.toLocaleString() ?? '—'}</strong></article>
                      <article><span>Evicted keys</span><strong>{server.evictedKeys?.toLocaleString() ?? '—'}</strong></article>
                      <article><span>Connected slaves</span><strong>{server.connectedSlaves ?? '—'}</strong></article>
                      <article><span>Master link</span><strong>{server.masterLinkStatus ?? '—'}</strong></article>
                      <article><span>CPU sys</span><strong>{server.usedCpuSys ?? '—'}</strong></article>
                      <article><span>CPU user</span><strong>{server.usedCpuUser ?? '—'}</strong></article>
                      <article><span>Total keys</span><strong>{server.totalKeys.toLocaleString()}</strong></article>
                    </div>
                    <div className="redis-section-heading redis-db-heading">
                      <h2>Databases</h2>
                    </div>
                    {server.databases.length ? (
                      <div className="redis-database-list">
                        {server.databases.map((database) => (
                          <article key={database.name}>
                            <strong>{database.name}</strong>
                            <span>{database.keys.toLocaleString()} keys</span>
                            <span>{database.expires.toLocaleString()} expiring</span>
                          </article>
                        ))}
                      </div>
                    ) : (
                      <div className="muted redis-no-databases">No populated databases reported.</div>
                    )}
                  </>
                )}
              </section>
            )}
          </>
        )}
      </main>
      {connectionEditor !== undefined && (
        <RedisConnectionForm
          key={connectionEditor?.id ?? 'new'}
          connection={connectionEditor}
          onClose={() => setConnectionEditor(undefined)}
          onSave={saveConnection}
        />
      )}
      {editor && (
        <RedisKeyEditor
          key={`${editor.key}-${editor.type}`}
          initial={editor}
          onClose={() => setEditor(null)}
          onSave={saveKey}
        />
      )}
    </div>
  )
}

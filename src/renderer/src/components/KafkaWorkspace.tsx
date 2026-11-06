import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  KafkaConnectionInput,
  KafkaAuthConfig,
  KafkaMessage,
  KafkaSaslMechanism,
  KafkaTopicInfo,
  KafkaTlsConfig,
  StoredKafkaConnection,
} from '../../../shared/types'
import type {
  KafkaMessageProduceInput,
  KafkaTopicCreateInput,
} from '../../../shared/ipc'
import { api, errorMessage } from '../api'
import { JsonEditor } from './JsonEditor'

const EMPTY_TLS: KafkaTlsConfig = {
  enabled: false,
  rejectUnauthorized: true,
  ca: '',
  cert: '',
  key: '',
  passphrase: '',
}

const NEW_CONNECTION: KafkaConnectionInput = {
  name: '',
  brokers: 'localhost:9092',
  auth: null,
  tls: EMPTY_TLS,
  timeoutMs: 10_000,
}

function makeAuth(
  mechanism: KafkaSaslMechanism,
  username: string,
  password: string,
): KafkaAuthConfig {
  switch (mechanism) {
    case 'plain':
      return { mechanism, username, password }
    case 'scram-sha-256':
      return { mechanism, username, password }
    case 'scram-sha-512':
      return { mechanism, username, password }
  }
}

interface KafkaConnectionFormProps {
  connection: StoredKafkaConnection | null
  onClose: () => void
  onSave: (input: KafkaConnectionInput) => Promise<void>
}

function KafkaConnectionForm({ connection, onClose, onSave }: KafkaConnectionFormProps) {
  const [draft, setDraft] = useState<KafkaConnectionInput>(() =>
    connection
      ? {
          id: connection.id,
          name: connection.name,
          brokers: connection.brokers,
          auth: connection.auth ? { ...connection.auth } : null,
          tls: { ...connection.tls },
          timeoutMs: connection.timeoutMs,
        }
      : { ...NEW_CONNECTION, tls: { ...EMPTY_TLS } },
  )
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const patchTls = (value: Partial<KafkaTlsConfig>) =>
    setDraft((current) => ({ ...current, tls: { ...current.tls, ...value } }))

  async function test(): Promise<void> {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await api.testKafkaConnection(draft)
      setTestResult(`Connected to ${result.brokers} broker(s) · cluster ${result.clusterId || 'unknown'}`)
    } catch (reason) {
      setTestResult(`Failed: ${errorMessage(reason)}`)
    } finally {
      setTesting(false)
    }
  }

  async function submit(): Promise<void> {
    setError(null)
    setSaving(true)
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
      <div className="modal kafka-connection-modal">
        <h2>{connection ? 'Edit Kafka connection' : 'New Kafka connection'}</h2>
        <div className="field-row">
          <label className="field">
            <span>Name</span>
            <input
              className="input"
              autoFocus
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Local Kafka"
            />
          </label>
          <label className="field">
            <span>Bootstrap brokers</span>
            <input
              className="input mono"
              value={draft.brokers}
              onChange={(event) => setDraft({ ...draft, brokers: event.target.value })}
              placeholder="kafka-1:9092,kafka-2:9092"
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Authentication</span>
            <select
              className="input"
              value={draft.auth?.mechanism ?? 'none'}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  auth:
                    event.target.value === 'none'
                      ? null
                      : {
                          ...makeAuth(
                            event.target.value as KafkaSaslMechanism,
                            draft.auth?.username ?? '',
                            draft.auth?.password ?? '',
                          ),
                        },
                })
              }
            >
              <option value="none">None</option>
              <option value="plain">SASL/PLAIN</option>
              <option value="scram-sha-256">SASL/SCRAM-SHA-256</option>
              <option value="scram-sha-512">SASL/SCRAM-SHA-512</option>
            </select>
          </label>
          <label className="field">
            <span>Timeout, ms</span>
            <input
              className="input"
              type="number"
              min={1000}
              step={1000}
              value={draft.timeoutMs}
              onChange={(event) =>
                setDraft({ ...draft, timeoutMs: Number(event.target.value) || 10_000 })
              }
            />
          </label>
        </div>

        {draft.auth && (
          <div className="field-row">
            <label className="field">
              <span>SASL username</span>
              <input
                className="input"
                value={draft.auth.username}
                onChange={(event) =>
                  setDraft({ ...draft, auth: { ...draft.auth!, username: event.target.value } })
                }
              />
            </label>
            <label className="field">
              <span>SASL password</span>
              <input
                className="input"
                type="password"
                value={draft.auth.password}
                onChange={(event) =>
                  setDraft({ ...draft, auth: { ...draft.auth!, password: event.target.value } })
                }
              />
            </label>
          </div>
        )}

        <label className="field checkbox">
          <input
            type="checkbox"
            checked={draft.tls.enabled}
            onChange={(event) => patchTls({ enabled: event.target.checked })}
          />
          Use TLS/SSL encryption
        </label>
        {draft.tls.enabled && (
          <>
            <label className="field checkbox">
              <input
                type="checkbox"
                checked={draft.tls.rejectUnauthorized}
                onChange={(event) => patchTls({ rejectUnauthorized: event.target.checked })}
              />
              Verify server certificate
            </label>
            <div className="field-row">
              <label className="field">
                <span>CA certificate (PEM, optional)</span>
                <textarea
                  className="input kafka-pem"
                  value={draft.tls.ca}
                  onChange={(event) => patchTls({ ca: event.target.value })}
                  placeholder="-----BEGIN CERTIFICATE-----"
                />
              </label>
              <label className="field">
                <span>Client certificate (PEM, optional)</span>
                <textarea
                  className="input kafka-pem"
                  value={draft.tls.cert}
                  onChange={(event) => patchTls({ cert: event.target.value })}
                  placeholder="-----BEGIN CERTIFICATE-----"
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Client private key (PEM, optional)</span>
                <textarea
                  className="input kafka-pem"
                  value={draft.tls.key}
                  onChange={(event) => patchTls({ key: event.target.value })}
                  placeholder="-----BEGIN PRIVATE KEY-----"
                />
              </label>
              <label className="field">
                <span>Private key passphrase (optional)</span>
                <input
                  className="input"
                  type="password"
                  value={draft.tls.passphrase}
                  onChange={(event) => patchTls({ passphrase: event.target.value })}
                />
              </label>
            </div>
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

function KafkaTopicCreateDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (input: KafkaTopicCreateInput) => Promise<boolean>
}) {
  const [topic, setTopic] = useState('')
  const [numPartitions, setNumPartitions] = useState(1)
  const [replicationFactor, setReplicationFactor] = useState(1)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    if (!topic.trim()) {
      setError('A topic name is required')
      return
    }
    if (!Number.isInteger(numPartitions) || numPartitions < 1) {
      setError('Partition count must be a positive integer')
      return
    }
    if (!Number.isInteger(replicationFactor) || replicationFactor < 1) {
      setError('Replication factor must be a positive integer')
      return
    }

    setCreating(true)
    setError(null)
    try {
      const created = await onCreate({ topic: topic.trim(), numPartitions, replicationFactor })
      if (created) onClose()
      else setError(`Topic "${topic.trim()}" already exists`)
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="modal kafka-action-modal">
        <h2>Create Kafka topic</h2>
        <label className="field">
          <span>Topic name</span>
          <input className="input mono" autoFocus value={topic} onChange={(event) => setTopic(event.target.value)} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Partitions</span>
            <input className="input" type="number" min={1} step={1} value={numPartitions}
              onChange={(event) => setNumPartitions(Number(event.target.value))} />
          </label>
          <label className="field">
            <span>Replication factor</span>
            <input className="input" type="number" min={1} step={1} value={replicationFactor}
              onChange={(event) => setReplicationFactor(Number(event.target.value))} />
          </label>
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={creating}>
            {creating ? 'Creating…' : 'Create topic'}
          </button>
        </div>
      </div>
    </div>
  )
}

function KafkaProduceDialog({
  topic,
  onClose,
  onSend,
}: {
  topic: string
  onClose: () => void
  onSend: (input: KafkaMessageProduceInput) => Promise<void>
}) {
  const [key, setKey] = useState('')
  const [value, setValue] = useState('{\n  \n}')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(): Promise<void> {
    try {
      JSON.parse(value)
    } catch {
      setError('Message value must be valid JSON')
      return
    }
    setSending(true)
    setError(null)
    try {
      await onSend({ topic, key: key || null, value })
      onClose()
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <div className="modal kafka-action-modal kafka-produce-modal">
        <h2>Send event to {topic}</h2>
        <label className="field">
          <span>Key (optional)</span>
          <input className="input mono" value={key} onChange={(event) => setKey(event.target.value)} />
        </label>
        <div className="field">
          <span>JSON value</span>
          <JsonEditor value={value} onChange={setValue} onRun={() => void submit()}
            placeholder="Enter a JSON value" minHeight="180px" />
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={sending}>
            {sending ? 'Sending…' : 'Send event'}
          </button>
        </div>
      </div>
    </div>
  )
}

function KafkaJsonViewer({ value }: { value: string }) {
  try {
    JSON.parse(value)
  } catch {
    return <pre>{value}</pre>
  }
  return (
    <div className="kafka-json-view">
      <JsonEditor value={value} onChange={() => undefined} readOnly minHeight="90px" />
    </div>
  )
}

export function KafkaWorkspace({ onClose }: { onClose: () => void }) {
  const [connections, setConnections] = useState<StoredKafkaConnection[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [topics, setTopics] = useState<KafkaTopicInfo[]>([])
  const [topicFilter, setTopicFilter] = useState('')
  const [selectedTopic, setSelectedTopic] = useState('')
  const [messages, setMessages] = useState<KafkaMessage[]>([])
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(20)
  const [loadingTopics, setLoadingTopics] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [editor, setEditor] = useState<StoredKafkaConnection | null | undefined>(undefined)
  const [creatingTopic, setCreatingTopic] = useState(false)
  const [producing, setProducing] = useState(false)
  const topicRequest = useRef(0)
  const messageRequest = useRef(0)

  const active = connections.find((connection) => connection.id === activeId) ?? null
  const visibleMessages = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    if (!needle) return messages
    return messages.filter((message) => JSON.stringify(message).toLocaleLowerCase().includes(needle))
  }, [messages, search])
  const visibleTopics = useMemo(() => {
    const needle = topicFilter.trim().toLocaleLowerCase()
    return needle ? topics.filter((item) => item.name.toLocaleLowerCase().includes(needle)) : topics
  }, [topics, topicFilter])

  async function reloadTopics(connectionId: string): Promise<void> {
    const request = ++topicRequest.current
    messageRequest.current += 1
    setLoadingTopics(true)
    setError(null)
    setTopics([])
    setSelectedTopic('')
    setMessages([])
    setLoadingMessages(false)
    try {
      const result = await api.listKafkaTopics(connectionId)
      if (request !== topicRequest.current) return
      setTopics(result)
    } catch (reason) {
      if (request !== topicRequest.current) return
      setError(errorMessage(reason))
    } finally {
      if (request === topicRequest.current) setLoadingTopics(false)
    }
  }

  useEffect(() => {
    void api.listKafkaConnections().then((items) => {
      setConnections(items)
      if (items[0]) {
        setActiveId(items[0].id)
        void reloadTopics(items[0].id)
      }
    }).catch((reason: unknown) => setError(errorMessage(reason)))
  }, [])

  async function save(input: KafkaConnectionInput): Promise<void> {
    const saved = await api.saveKafkaConnection(input)
    const next = await api.listKafkaConnections()
    setConnections(next)
    setActiveId(saved.id)
    setEditor(undefined)
    await reloadTopics(saved.id)
  }

  async function remove(connection: StoredKafkaConnection): Promise<void> {
    if (!window.confirm(`Delete Kafka connection "${connection.name}"?`)) return
    try {
      await api.deleteKafkaConnection(connection.id)
      const next = await api.listKafkaConnections()
      setConnections(next)
      if (activeId === connection.id) {
        setActiveId(next[0]?.id ?? null)
        if (next[0]) await reloadTopics(next[0].id)
        else {
          topicRequest.current += 1
          messageRequest.current += 1
          setTopics([])
          setSelectedTopic('')
          setMessages([])
          setLoadingTopics(false)
          setLoadingMessages(false)
        }
      }
    } catch (reason) {
      setError(errorMessage(reason))
    }
  }

  async function loadMessages(topic = selectedTopic): Promise<void> {
    if (!active || !topic) return
    const request = ++messageRequest.current
    const connectionId = active.id
    setSelectedTopic(topic)
    setLoadingMessages(true)
    setError(null)
    try {
      const result = await api.fetchKafkaMessages(connectionId, { topic, limit })
      if (request !== messageRequest.current) return
      setMessages(result)
    } catch (reason) {
      if (request !== messageRequest.current) return
      setError(errorMessage(reason))
      setMessages([])
    } finally {
      if (request === messageRequest.current) setLoadingMessages(false)
    }
  }

  async function createTopic(input: KafkaTopicCreateInput): Promise<boolean> {
    if (!active) return false
    setError(null)
    setNotice(null)
    const created = await api.createKafkaTopic(active.id, input)
    if (created) {
      await reloadTopics(active.id)
      setSelectedTopic(input.topic)
      setNotice(`Topic "${input.topic}" created`)
    }
    return created
  }

  async function produceMessage(input: KafkaMessageProduceInput): Promise<void> {
    if (!active) throw new Error('No Kafka connection selected')
    setError(null)
    setNotice(null)
    await api.produceKafkaMessage(active.id, input)
    setNotice(`Event sent to "${input.topic}"`)
  }

  return (
    <div className="app">
      <aside className="sidebar kafka-sidebar">
        <div className="sidebar-header">
          <span className="logo">◈</span> Kafka Browser
        </div>
        <button className="btn btn-block" onClick={onClose}>← Product selection</button>
        <div className="sidebar-label">Kafka connections</div>
        <div className="conn-list">
          {connections.map((connection) => (
            <div
              key={connection.id}
              className={`conn-item${connection.id === activeId ? ' active' : ''}`}
              onClick={() => {
                setActiveId(connection.id)
                void reloadTopics(connection.id)
              }}
            >
              <span className={`dot dot-${connection.id === activeId ? 'green' : 'unknown'}`} />
              <div className="conn-meta">
                <div className="conn-name">{connection.name}</div>
                <div className="conn-url">{connection.brokers}</div>
              </div>
              <div className="conn-actions">
                <button title="Edit" onClick={(event) => { event.stopPropagation(); setEditor(connection) }}>✎</button>
                <button title="Delete" onClick={(event) => { event.stopPropagation(); void remove(connection) }}>✕</button>
              </div>
            </div>
          ))}
          {connections.length === 0 && <div className="conn-empty">No Kafka connections</div>}
        </div>
        <button className="btn btn-primary btn-block" onClick={() => setEditor(null)}>
          + Add Kafka connection
        </button>
      </aside>

      <main className="workspace kafka-workspace">
        <header className="ws-header">
          <div className="ws-header-title">
            <h1 className="ws-title">{active?.name ?? 'Kafka'}</h1>
            <div className="ws-sub">{active?.brokers ?? 'Add a connection to browse Kafka topics and messages.'}</div>
          </div>
          {active && (
            <div className="ws-actions">
              <button className="btn" onClick={() => void reloadTopics(active.id)} disabled={loadingTopics}>
                {loadingTopics ? 'Loading…' : 'Refresh topics'}
              </button>
            </div>
          )}
        </header>

        {error && <div className="banner banner-error kafka-error">{error}</div>}
        {notice && <div className="banner banner-ok kafka-notice">{notice}</div>}

        {!active ? (
          <div className="empty-state kafka-empty">
            <div className="empty-title">No Kafka connection selected</div>
            <div>Connect to a broker to browse topics and inspect recent events.</div>
            <button className="btn btn-primary" onClick={() => setEditor(null)}>+ Add Kafka connection</button>
          </div>
        ) : (
          <div className="kafka-content">
            <section className="kafka-topics">
              <div className="kafka-section-heading">
                <h2>Topics</h2>
                <div className="kafka-topic-actions">
                  <span className="muted">{topics.length}</span>
                  <button className="btn" onClick={() => setCreatingTopic(true)}>+ Create</button>
                </div>
              </div>
              <input
                className="input"
                placeholder="Filter topics…"
                value={topicFilter}
                onChange={(event) => setTopicFilter(event.target.value)}
              />
              <div className="kafka-topic-list">
                {visibleTopics.map((topic) => (
                  <button
                    key={topic.name}
                    className={`kafka-topic${selectedTopic === topic.name ? ' active' : ''}`}
                    onClick={() => void loadMessages(topic.name)}
                  >
                    <span>{topic.name}</span>
                    <span className="muted">{topic.partitions}p</span>
                  </button>
                ))}
                {!loadingTopics && topics.length === 0 && <div className="muted kafka-empty-topics">No topics found</div>}
              </div>
            </section>

            <section className="kafka-messages">
              <div className="kafka-section-heading">
                <h2>{selectedTopic || 'Select a topic'}</h2>
                <span className="muted">{visibleMessages.length} / {messages.length} messages</span>
              </div>
              <div className="kafka-message-tools">
                <input
                  className="input"
                  placeholder="Search text in loaded messages…"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  disabled={!messages.length}
                />
                <select
                  className="input kafka-limit"
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value))}
                >
                  {[10, 20, 50, 100].map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
                <button
                  className="btn"
                  onClick={() => void loadMessages()}
                  disabled={!selectedTopic || loadingMessages}
                >
                  {loadingMessages ? 'Loading…' : 'Load recent'}
                </button>
                <button className="btn btn-primary" onClick={() => setProducing(true)} disabled={!selectedTopic}>
                  Send event
                </button>
              </div>
              <div className="kafka-message-list">
                {visibleMessages.map((message) => (
                  <details className="kafka-message" key={`${message.topic}-${message.partition}-${message.offset}`}>
                    <summary className="kafka-message-meta">
                      <span>Partition {message.partition}</span>
                      <span>Offset {message.offset}</span>
                      <span>{message.timestamp ? new Date(Number(message.timestamp)).toLocaleString() : 'No timestamp'}</span>
                      {message.key !== null && <span>Key: {message.key}</span>}
                    </summary>
                    <div className="kafka-message-body">
                      {message.value === null ? <pre>(null value)</pre> : <KafkaJsonViewer value={message.value} />}
                      {Object.keys(message.headers).length > 0 && (
                        <details>
                          <summary>Headers ({Object.keys(message.headers).length})</summary>
                          <KafkaJsonViewer value={JSON.stringify(message.headers, null, 2)} />
                        </details>
                      )}
                    </div>
                  </details>
                ))}
                {selectedTopic && !loadingMessages && messages.length === 0 && (
                  <div className="muted kafka-empty-messages">No recent messages in this topic</div>
                )}
                {messages.length > 0 && visibleMessages.length === 0 && (
                  <div className="muted kafka-empty-messages">No messages match this search</div>
                )}
              </div>
            </section>
          </div>
        )}
      </main>
      {editor !== undefined && (
        <KafkaConnectionForm
          key={editor?.id ?? 'new-kafka'}
          connection={editor}
          onClose={() => setEditor(undefined)}
          onSave={save}
        />
      )}
      {creatingTopic && (
        <KafkaTopicCreateDialog onClose={() => setCreatingTopic(false)} onCreate={createTopic} />
      )}
      {producing && selectedTopic && (
        <KafkaProduceDialog topic={selectedTopic} onClose={() => setProducing(false)} onSend={produceMessage} />
      )}
    </div>
  )
}

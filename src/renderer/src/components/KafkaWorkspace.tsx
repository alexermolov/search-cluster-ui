import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KafkaConnectionInput,
  KafkaAuthConfig,
  KafkaMessage,
  KafkaSaslMechanism,
  KafkaTopicInfo,
  KafkaTlsConfig,
  StoredKafkaConnection,
  KafkaPartitionInfo,
  KafkaConsumerGroupInfo,
  ThriftProfile,
} from "../../../shared/types";
import type {
  KafkaBatchProduceInput,
  KafkaMessageProduceInput,
  KafkaTopicCreateInput,
} from "../../../shared/ipc";
import { api, errorMessage } from "../api";
import { JsonEditor } from "./JsonEditor";
import { JsonView } from "./JsonView";
import { CommandPalettePanel, useKafkaPaletteCommands } from "./CommandPalette";
import { addToast } from "../toasts";
import { KafkaThriftProfilesDialog } from "./KafkaThriftProfilesDialog";
import {
  KafkaBatchSendDialog,
  type KafkaBatchProduceDraft,
} from "./KafkaBatchSendDialog";

const EMPTY_TLS: KafkaTlsConfig = {
  enabled: false,
  rejectUnauthorized: true,
  ca: "",
  cert: "",
  key: "",
  passphrase: "",
};

const NEW_CONNECTION: KafkaConnectionInput = {
  name: "",
  brokers: "localhost:9092",
  auth: null,
  tls: EMPTY_TLS,
  timeoutMs: 10_000,
};

function makeAuth(
  mechanism: KafkaSaslMechanism,
  username: string,
  password: string,
): KafkaAuthConfig {
  switch (mechanism) {
    case "plain":
      return { mechanism, username, password };
    case "scram-sha-256":
      return { mechanism, username, password };
    case "scram-sha-512":
      return { mechanism, username, password };
  }
}

interface KafkaConnectionFormProps {
  connection: StoredKafkaConnection | null;
  onClose: () => void;
  onSave: (input: KafkaConnectionInput) => Promise<void>;
}

function KafkaConnectionForm({
  connection,
  onClose,
  onSave,
}: KafkaConnectionFormProps) {
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
  );
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patchTls = (value: Partial<KafkaTlsConfig>) =>
    setDraft((current) => ({ ...current, tls: { ...current.tls, ...value } }));

  async function test(): Promise<void> {
    setTesting(true);
    try {
      const result = await api.testKafkaConnection(draft);
      addToast(
        `Connected to ${result.brokers} broker(s) · cluster ${result.clusterId || "unknown"}`,
        "success",
      );
    } catch (reason) {
      addToast(`Failed: ${errorMessage(reason)}`, "error");
    } finally {
      setTesting(false);
    }
  }

  async function submit(): Promise<void> {
    setError(null);
    setSaving(true);
    try {
      await onSave(draft);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal kafka-connection-modal">
        <h2>{connection ? "Edit Kafka connection" : "New Kafka connection"}</h2>
        <div className="field-row">
          <label className="field">
            <span>Name</span>
            <input
              className="input"
              autoFocus
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder="Local Kafka"
            />
          </label>
          <label className="field">
            <span>Bootstrap brokers</span>
            <input
              className="input mono"
              value={draft.brokers}
              onChange={(event) =>
                setDraft({ ...draft, brokers: event.target.value })
              }
              placeholder="kafka-1:9092,kafka-2:9092"
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Authentication</span>
            <select
              className="input"
              value={draft.auth?.mechanism ?? "none"}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  auth:
                    event.target.value === "none"
                      ? null
                      : {
                          ...makeAuth(
                            event.target.value as KafkaSaslMechanism,
                            draft.auth?.username ?? "",
                            draft.auth?.password ?? "",
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
                setDraft({
                  ...draft,
                  timeoutMs: Number(event.target.value) || 10_000,
                })
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
                  setDraft({
                    ...draft,
                    auth: { ...draft.auth!, username: event.target.value },
                  })
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
                  setDraft({
                    ...draft,
                    auth: { ...draft.auth!, password: event.target.value },
                  })
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
                onChange={(event) =>
                  patchTls({ rejectUnauthorized: event.target.checked })
                }
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
                  onChange={(event) =>
                    patchTls({ passphrase: event.target.value })
                  }
                />
              </label>
            </div>
          </>
        )}

        {error && <div className="banner banner-error">{error}</div>}
        <div className="modal-footer">
          <button
            className="btn"
            onClick={() => void test()}
            disabled={testing}
          >
            {testing ? "Testing…" : "Test"}
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function KafkaTopicCreateDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: KafkaTopicCreateInput) => Promise<boolean>;
}) {
  const [topic, setTopic] = useState("");
  const [numPartitions, setNumPartitions] = useState(1);
  const [replicationFactor, setReplicationFactor] = useState(1);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    if (!topic.trim()) {
      setError("A topic name is required");
      return;
    }
    if (!Number.isInteger(numPartitions) || numPartitions < 1) {
      setError("Partition count must be a positive integer");
      return;
    }
    if (!Number.isInteger(replicationFactor) || replicationFactor < 1) {
      setError("Replication factor must be a positive integer");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const created = await onCreate({
        topic: topic.trim(),
        numPartitions,
        replicationFactor,
      });
      if (created) onClose();
      else setError(`Topic "${topic.trim()}" already exists`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal kafka-action-modal">
        <h2>Create Kafka topic</h2>
        <label className="field">
          <span>Topic name</span>
          <input
            className="input mono"
            autoFocus
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Partitions</span>
            <input
              className="input"
              type="number"
              min={1}
              step={1}
              value={numPartitions}
              onChange={(event) => setNumPartitions(Number(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Replication factor</span>
            <input
              className="input"
              type="number"
              min={1}
              step={1}
              value={replicationFactor}
              onChange={(event) =>
                setReplicationFactor(Number(event.target.value))
              }
            />
          </label>
        </div>
        {error && <div className="banner banner-error">{error}</div>}
        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={creating}
          >
            {creating ? "Creating…" : "Create topic"}
          </button>
        </div>
      </div>
    </div>
  );
}

type KafkaProduceDraft = {
  key: string;
  format: "raw" | "json" | "thrift";
  value: string;
  thriftProfileId: string;
  thriftIdl: string;
  thriftStruct: string;
};

const EMPTY_KAFKA_PRODUCE_DRAFT: KafkaProduceDraft = {
  key: "",
  format: "json",
  value: "{\n  \n}",
  thriftProfileId: "",
  thriftIdl: "",
  thriftStruct: "",
};

function KafkaProduceDialog({
  topic,
  draft,
  profiles,
  onDraftChange,
  onClose,
  onSend,
}: {
  topic: string;
  draft: KafkaProduceDraft;
  profiles: ThriftProfile[];
  onDraftChange: (patch: Partial<KafkaProduceDraft>) => void;
  onClose: () => void;
  onSend: (input: KafkaMessageProduceInput) => Promise<void>;
}) {
  const [thriftStructs, setThriftStructs] = useState<string[]>([]);
  const [thriftError, setThriftError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thriftStructRef = useRef(draft.thriftStruct);
  thriftStructRef.current = draft.thriftStruct;

  useEffect(() => {
    if (draft.format !== "thrift" || !draft.thriftProfileId) {
      setThriftStructs([]);
      setThriftError(null);
      return;
    }
    const profile = profiles.find((p) => p.id === draft.thriftProfileId);
    if (!profile) {
      setThriftStructs([]);
      setThriftError(null);
      return;
    }
    let cancelled = false;
    api
      .parseThriftIDL(profile.idl)
      .then((names) => {
        if (cancelled) return;
        setThriftStructs(names);
        setThriftError(null);
        if (names.length === 1) {
          onDraftChange({ thriftStruct: names[0], thriftIdl: profile.idl });
        } else if (!names.includes(thriftStructRef.current)) {
          onDraftChange({ thriftStruct: "", thriftIdl: profile.idl });
        } else {
          onDraftChange({ thriftIdl: profile.idl });
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setThriftStructs([]);
        setThriftError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [draft.format, draft.thriftProfileId, profiles, onDraftChange]);

  async function submit(): Promise<void> {
    if (draft.format === "json" || draft.format === "thrift") {
      try {
        JSON.parse(draft.value);
      } catch {
        setError("Message value must be valid JSON");
        return;
      }
    }
    if (draft.format === "thrift") {
      if (!draft.thriftProfileId) {
        setError("Please select a Thrift profile");
        return;
      }
      const profile = profiles.find((p) => p.id === draft.thriftProfileId);
      if (!profile) {
        setError("Selected Thrift profile not found");
        return;
      }
      if (!draft.thriftStruct) {
        setError("Please select a Thrift struct");
        return;
      }
    }
    setSending(true);
    setError(null);
    try {
      await onSend({
        topic,
        key: draft.key || null,
        value: draft.value,
        format: draft.format,
        thrift:
          draft.format === "thrift"
            ? { idl: draft.thriftIdl, structName: draft.thriftStruct }
            : undefined,
      });
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal kafka-action-modal kafka-produce-modal">
        <h2>Send event to {topic}</h2>
        <div className="field-row">
          <label className="field">
            <span>Key (optional)</span>
            <input
              className="input mono"
              value={draft.key}
              onChange={(event) => onDraftChange({ key: event.target.value })}
            />
          </label>
          <label className="field">
            <span>Format</span>
            <select
              className="input"
              value={draft.format}
              onChange={(event) =>
                onDraftChange({
                  format: event.target.value as KafkaProduceDraft["format"],
                })
              }
            >
              <option value="json">JSON</option>
              <option value="raw">Raw string</option>
              <option value="thrift">Thrift</option>
            </select>
          </label>
        </div>

        {draft.format === "raw" && (
          <label className="field">
            <span>Raw value</span>
            <textarea
              className="input mono"
              value={draft.value}
              onChange={(event) => onDraftChange({ value: event.target.value })}
              rows={10}
              placeholder="Free-form text"
              style={{ minHeight: "180px", fontFamily: "monospace" }}
            />
          </label>
        )}

        {draft.format === "json" && (
          <div className="field">
            <span>JSON value</span>
            <JsonEditor
              value={draft.value}
              onChange={(value) => onDraftChange({ value })}
              onRun={() => void submit()}
              placeholder="Enter a JSON value"
              minHeight="180px"
            />
          </div>
        )}

        {draft.format === "thrift" && (
          <>
            <label className="field">
              <span>Thrift profile</span>
              <select
                className="input"
                value={draft.thriftProfileId}
                onChange={(event) =>
                  onDraftChange({ thriftProfileId: event.target.value })
                }
              >
                <option value="">— Select profile —</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              {profiles.length === 0 && (
                <span className="muted">
                  Create a profile in the decode toolbar first
                </span>
              )}
            </label>
            {draft.thriftProfileId && thriftError && (
              <div className="banner banner-error" style={{ marginTop: -6 }}>
                {thriftError}
              </div>
            )}
            {draft.thriftProfileId && thriftStructs.length > 0 && (
              <label className="field">
                <span>Struct / Exception / Union</span>
                <select
                  className="input"
                  value={draft.thriftStruct}
                  onChange={(event) =>
                    onDraftChange({ thriftStruct: event.target.value })
                  }
                >
                  <option value="">— Select —</option>
                  {thriftStructs.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="field">
              <span>JSON payload (will be serialized to Thrift binary)</span>
              <JsonEditor
                value={draft.value}
                onChange={(value) => onDraftChange({ value })}
                onRun={() => void submit()}
                placeholder="Enter JSON matching the Thrift struct"
                minHeight="160px"
              />
            </div>
          </>
        )}

        {error && <div className="banner banner-error">{error}</div>}
        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={sending}
          >
            {sending ? "Sending…" : "Send event"}
          </button>
        </div>
      </div>
    </div>
  );
}

function KafkaJsonViewer({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  return (
    <div className="kafka-json-view">
      <pre>
        <JsonView value={value} collapsible />
      </pre>
      <button
        className="json-copy-btn"
        onClick={() => void copy()}
        title="Copy JSON to clipboard"
      >
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

function KafkaMessageAccordion({
  message,
  thriftIdl,
  structName,
  loadingProfile,
}: {
  message: KafkaMessage;
  thriftIdl: string | null;
  structName: string;
  loadingProfile: boolean;
}) {
  const [decodedJson, setDecodedJson] = useState<string | null>(null);
  const [decoding, setDecoding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    setDecodedJson(null);
    setError(null);
  }, [thriftIdl, structName]);

  async function toggleDecode(): Promise<void> {
    if (decodedJson !== null) {
      setDecodedJson(null);
      setError(null);
      return;
    }
    if (message.valueBase64 === null || !thriftIdl || !structName) return;
    setDecoding(true);
    setError(null);
    try {
      const value = await api.decodeKafkaThrift(
        message.valueBase64,
        thriftIdl,
        structName,
      );
      setDecodedJson(JSON.stringify(value, null, 2) ?? "null");
      if (detailsRef.current) detailsRef.current.open = true;
    } catch (reason) {
      setError(errorMessage(reason));
      if (detailsRef.current) detailsRef.current.open = true;
    } finally {
      setDecoding(false);
    }
  }

  return (
    <details className="kafka-message" ref={detailsRef}>
      <summary className="kafka-message-meta">
        <span>Partition {message.partition}</span>
        <span>Offset {message.offset}</span>
        <span>
          {message.timestamp
            ? new Date(Number(message.timestamp)).toLocaleString()
            : "No timestamp"}
        </span>
        {message.key !== null && <span>Key: {message.key}</span>}
        <button
          className="btn kafka-decode-toggle"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void toggleDecode();
          }}
          disabled={
            message.valueBase64 === null ||
            !thriftIdl ||
            !structName ||
            loadingProfile ||
            decoding
          }
        >
          {decoding ? "Decoding…" : decodedJson !== null ? "Close decode" : "Decode"}
        </button>
      </summary>
      {decodedJson !== null && (
        <div className="kafka-thrift-decoded">
          {error ? (
            <div className="banner banner-error">{error}</div>
          ) : (
            <KafkaJsonViewer value={decodedJson} />
          )}
        </div>
      )}
      <div className="kafka-message-body">
        {message.value === null ? (
          <pre>(null value)</pre>
        ) : (
          <KafkaJsonViewer value={message.value} />
        )}
        {Object.keys(message.headers).length > 0 && (
          <details>
            <summary>Headers ({Object.keys(message.headers).length})</summary>
            <KafkaJsonViewer
              value={JSON.stringify(message.headers, null, 2)}
            />
          </details>
        )}
      </div>
    </details>
  );
}

function KafkaTopicDetailDialog({
  topic,
  partitions,
  consumerGroups,
  loading,
  onClose,
}: {
  topic: string;
  partitions: KafkaPartitionInfo[];
  consumerGroups: KafkaConsumerGroupInfo[];
  loading: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"partitions" | "groups">("partitions");

  const topicGroups = useMemo(() => {
    return consumerGroups.filter((g) => topic in g.lag);
  }, [consumerGroups, topic]);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal kafka-detail-modal">
        <h2>Topic: {topic}</h2>
        <div className="kafka-detail-tabs">
          <button
            className={`kafka-detail-tab${tab === "partitions" ? " active" : ""}`}
            onClick={() => setTab("partitions")}
          >
            Partitions ({partitions.length})
          </button>
          <button
            className={`kafka-detail-tab${tab === "groups" ? " active" : ""}`}
            onClick={() => setTab("groups")}
          >
            Consumer Groups ({topicGroups.length})
          </button>
        </div>

        {loading && <div className="muted">Loading…</div>}

        {!loading && tab === "partitions" && (
          <div style={{ overflow: "auto" }}>
            <table className="kafka-partition-table">
              <thead>
                <tr>
                  <th>Partition</th>
                  <th>Leader</th>
                  <th>Replicas</th>
                  <th>ISR</th>
                  <th>Low Offset</th>
                  <th>High Offset</th>
                </tr>
              </thead>
              <tbody>
                {partitions.map((p) => (
                  <tr key={p.partition}>
                    <td>{p.partition}</td>
                    <td>{p.leader ?? "-"}</td>
                    <td>{p.replicas.join(", ")}</td>
                    <td>{p.isr.join(", ")}</td>
                    <td>{p.lowOffset}</td>
                    <td>{p.highOffset}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && tab === "groups" && (
          <div style={{ overflow: "auto" }}>
            {topicGroups.length === 0 && (
              <div className="kafka-empty-groups">
                No consumer groups for this topic
              </div>
            )}
            {topicGroups.map((group) => (
              <div className="kafka-consumer-group" key={group.groupId}>
                <div className="kafka-consumer-group-header">
                  <span className="group-id">{group.groupId}</span>
                  <span
                    className={`group-state state-${group.state.toLowerCase()}`}
                  >
                    {group.state}
                  </span>
                </div>
                <div className="kafka-consumer-group-body">
                  <div className="group-members">
                    Protocol: {group.protocol || "—"} · Members:{" "}
                    {group.members.length}
                  </div>
                  {group.lag[topic] &&
                    Object.keys(group.lag[topic]).length > 0 && (
                      <table className="kafka-lag-table">
                        <thead>
                          <tr>
                            <th>Partition</th>
                            <th>Lag</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(group.lag[topic])
                            .sort(([a], [b]) => Number(a) - Number(b))
                            .map(([partition, lag]) => (
                              <tr key={partition}>
                                <td>{partition}</td>
                                <td
                                  className={
                                    lag > 1000
                                      ? "lag-high"
                                      : lag > 100
                                        ? "lag-medium"
                                        : "lag-low"
                                  }
                                >
                                  {lag.toLocaleString()}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function KafkaWorkspace({ onClose }: { onClose: () => void }) {
  const [connections, setConnections] = useState<StoredKafkaConnection[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"topics" | "consumers">("topics");
  const [topics, setTopics] = useState<KafkaTopicInfo[]>([]);
  const [topicFilter, setTopicFilter] = useState("");
  const [consumerFilter, setConsumerFilter] = useState("");
  const [selectedConsumerGroupId, setSelectedConsumerGroupId] = useState("");
  const [selectedTopic, setSelectedTopic] = useState("");
  const [messages, setMessages] = useState<KafkaMessage[]>([]);
  const [profiles, setProfiles] = useState<ThriftProfile[]>(() => {
    try {
      const raw = localStorage.getItem("kafka-thrift-profiles");
      return raw ? (JSON.parse(raw) as ThriftProfile[]) : [];
    } catch {
      return [];
    }
  });
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [selectedProfileId, setSelectedProfileId] = useState<string>(() => {
    try {
      return localStorage.getItem("kafka-thrift-selected-profile-id") || "";
    } catch {
      return "";
    }
  });
  const [selectedStructName, setSelectedStructName] = useState<string>(() => {
    try {
      return localStorage.getItem("kafka-thrift-selected-struct") || "";
    } catch {
      return "";
    }
  });
  const [profileStructs, setProfileStructs] = useState<string[]>([]);
  const [loadingProfileStructs, setLoadingProfileStructs] = useState(false);
  const [totalMessages, setTotalMessages] = useState(0);
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<KafkaMessage[] | null>(
    null,
  );
  const [searchScanned, setSearchScanned] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchCancelled, setSearchCancelled] = useState(false);
  const [limit, setLimit] = useState(20);
  const [fetchMode, setFetchMode] = useState<"beginning" | "end" | "offset">(
    "end",
  );
  const [offsetPartition, setOffsetPartition] = useState(0);
  const [messageOffset, setMessageOffset] = useState("0");
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [loadingConsumers, setLoadingConsumers] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    StoredKafkaConnection | null | undefined
  >(undefined);
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [producing, setProducing] = useState(false);
  const [produceDraft, setProduceDraft] = useState<KafkaProduceDraft>(
    EMPTY_KAFKA_PRODUCE_DRAFT,
  );
  const [batchProducing, setBatchProducing] = useState(false);
  const [batchDraft, setBatchDraft] = useState<KafkaBatchProduceDraft>({
    ...EMPTY_KAFKA_PRODUCE_DRAFT,
    count: 1000,
    threads: 4,
    batchSize: 500,
  });
  const [detailTopic, setDetailTopic] = useState<string | null>(null);
  const [partitions, setPartitions] = useState<KafkaPartitionInfo[]>([]);
  const [consumerGroups, setConsumerGroups] = useState<
    KafkaConsumerGroupInfo[]
  >([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const topicRequest = useRef(0);
  const consumerRequest = useRef(0);
  const messageRequest = useRef(0);
  const searchRequest = useRef(0);
  const activeSearchId = useRef<string | null>(null);
  const updateProduceDraft = useCallback(
    (patch: Partial<KafkaProduceDraft>) => {
      setProduceDraft((current) => ({ ...current, ...patch }));
    },
    [],
  );
  const updateBatchProduceDraft = useCallback(
    (patch: Partial<KafkaBatchProduceDraft>) => {
      setBatchDraft((current) => ({ ...current, ...patch }));
    },
    [],
  );

  const active =
    connections.find((connection) => connection.id === activeId) ?? null;
  const searchableMessages = useMemo(
    () =>
      messages.map((message) => JSON.stringify(message).toLocaleLowerCase()),
    [messages],
  );
  const visibleMessages = useMemo(() => {
    if (searchResults !== null) return searchResults;
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return messages;
    return messages.filter((_, index) =>
      searchableMessages[index].includes(needle),
    );
  }, [messages, search, searchableMessages, searchResults]);
  const visibleTopics = useMemo(() => {
    const needle = topicFilter.trim().toLocaleLowerCase();
    return needle
      ? topics.filter((item) => item.name.toLocaleLowerCase().includes(needle))
      : topics;
  }, [topics, topicFilter]);
  const visibleConsumerGroups = useMemo(() => {
    const needle = consumerFilter.trim().toLocaleLowerCase();
    return consumerGroups.filter((group) => {
      return [
        group.groupId,
        group.state,
        group.protocol,
        ...group.members.flatMap((member) => [
          member.clientId,
          member.clientHost,
          member.memberId,
          ...member.assignments.map((assignment) => assignment.topic),
        ]),
      ].some((value) => value.toLocaleLowerCase().includes(needle));
    });
  }, [consumerGroups, consumerFilter]);
  const selectedConsumerGroup =
    consumerGroups.find((group) => group.groupId === selectedConsumerGroupId) ??
    null;
  const selectedConsumerTopics = selectedConsumerGroup
    ? [
        ...new Set(
          selectedConsumerGroup.members.flatMap((member) =>
            member.assignments.map((assignment) => assignment.topic),
          ),
        ),
      ].sort((a, b) => a.localeCompare(b))
    : [];

  const cancelSearch = useCallback((): void => {
    const requestId = activeSearchId.current;
    if (!requestId) return;
    activeSearchId.current = null;
    api.cancelRequest(requestId);
    setSearching(false);
    setSearchCancelled(true);
  }, []);

  const reloadTopics = useCallback(
    async (connectionId: string): Promise<void> => {
      cancelSearch();
      const request = ++topicRequest.current;
      messageRequest.current += 1;
      setLoadingTopics(true);
      setError(null);
      setTopics([]);
      setSelectedTopic("");
      setMessages([]);
      setTotalMessages(0);
      setSearchResults(null);
      setLoadingMessages(false);
      try {
        const result = await api.listKafkaTopics(connectionId);
        if (request !== topicRequest.current) return;
        setTopics(result);
      } catch (reason) {
        if (request !== topicRequest.current) return;
        setError(errorMessage(reason));
      } finally {
        if (request === topicRequest.current) setLoadingTopics(false);
      }
    },
    [cancelSearch],
  );

  const reloadConsumerGroups = useCallback(
    async (connectionId: string): Promise<void> => {
      const request = ++consumerRequest.current;
      setLoadingConsumers(true);
      setError(null);
      setConsumerGroups([]);
      setSelectedConsumerGroupId("");
      try {
        const result = await api.fetchKafkaConsumerGroups(
          connectionId,
          undefined,
          false,
        );
        if (request !== consumerRequest.current) return;
        setConsumerGroups(result);
        setSelectedConsumerGroupId(result[0]?.groupId ?? "");
      } catch (reason) {
        if (request !== consumerRequest.current) return;
        setError(errorMessage(reason));
      } finally {
        if (request === consumerRequest.current) setLoadingConsumers(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (viewMode !== "consumers" || !activeId) return;
    void reloadConsumerGroups(activeId);
    return () => {
      consumerRequest.current += 1;
    };
  }, [activeId, viewMode, reloadConsumerGroups]);

  useEffect(() => {
    void api
      .listKafkaConnections()
      .then((items) => {
        setConnections(items);
        if (items[0]) {
          setActiveId(items[0].id);
          void reloadTopics(items[0].id);
        }
      })
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, [reloadTopics]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if ((mod && e.key.toLowerCase() === "r") || e.key === "F5") {
        e.preventDefault();
        if (!activeId) return;
        if (viewMode === "topics") void reloadTopics(activeId);
        else void reloadConsumerGroups(activeId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeId, viewMode, reloadConsumerGroups, reloadTopics]);

  async function save(input: KafkaConnectionInput): Promise<void> {
    const saved = await api.saveKafkaConnection(input);
    const next = await api.listKafkaConnections();
    setConnections(next);
    setActiveId(saved.id);
    setEditor(undefined);
    await reloadTopics(saved.id);
  }

  async function remove(connection: StoredKafkaConnection): Promise<void> {
    if (!window.confirm(`Delete Kafka connection "${connection.name}"?`))
      return;
    try {
      await api.deleteKafkaConnection(connection.id);
      const next = await api.listKafkaConnections();
      setConnections(next);
      if (activeId === connection.id) {
        setActiveId(next[0]?.id ?? null);
        if (next[0]) await reloadTopics(next[0].id);
        else {
          topicRequest.current += 1;
          messageRequest.current += 1;
          setTopics([]);
          setSelectedTopic("");
          setMessages([]);
          setTotalMessages(0);
          setSearchResults(null);
          setLoadingTopics(false);
          setLoadingMessages(false);
        }
      }
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  async function loadMessages(topic = selectedTopic): Promise<void> {
    if (!active || !topic) return;
    const partition = topic === selectedTopic ? offsetPartition : 0;
    if (fetchMode === "offset" && !/^\d+$/.test(messageOffset.trim())) {
      setError("Offset must be a non-negative integer");
      return;
    }
    cancelSearch();
    const request = ++messageRequest.current;
    const connectionId = active.id;
    setSelectedTopic(topic);
    if (topic !== selectedTopic) setOffsetPartition(0);
    setSearchResults(null);
    setMessages([]);
    setLoadingMessages(true);
    setError(null);
    try {
      const input =
        fetchMode === "offset"
          ? {
              topic,
              limit,
              mode: "offset" as const,
              partition,
              offset: messageOffset.trim(),
            }
          : { topic, limit, mode: fetchMode };
      const result = await api.fetchKafkaMessages(connectionId, input);
      if (request !== messageRequest.current) return;
      setMessages(result.messages);
      setTotalMessages(result.total);
    } catch (reason) {
      if (request !== messageRequest.current) return;
      setError(errorMessage(reason));
      setMessages([]);
      setTotalMessages(0);
    } finally {
      if (request === messageRequest.current) setLoadingMessages(false);
    }
  }

  function openSubscribedTopic(topic: string): void {
    setViewMode("topics");
    setTopicFilter("");
    void loadMessages(topic);
  }

  async function searchTopic(): Promise<void> {
    if (!active || !selectedTopic || !search.trim() || loadingMessages) return;
    cancelSearch();
    const requestId = `kafka-search-${active.id}-${++searchRequest.current}`;
    activeSearchId.current = requestId;
    setSearching(true);
    setSearchResults([]);
    setSearchScanned(0);
    setSearchCancelled(false);
    setError(null);
    try {
      const result = await api.searchKafkaMessages(
        active.id,
        { topic: selectedTopic, query: search, limit },
        requestId,
        (progress) => {
          if (activeSearchId.current !== requestId) return;
          setSearchResults(progress.messages);
          setSearchScanned(progress.scanned);
        },
      );
      if (activeSearchId.current !== requestId) return;
      setSearchResults(result.messages);
      setSearchScanned(result.scanned);
    } catch (reason) {
      if (activeSearchId.current !== requestId) return;
      if (errorMessage(reason) === "Request cancelled") {
        setSearchCancelled(true);
      } else {
        setSearchResults(null);
        setSearchScanned(0);
        setError(errorMessage(reason));
      }
    } finally {
      if (activeSearchId.current === requestId) {
        activeSearchId.current = null;
        setSearching(false);
      }
    }
  }

  useEffect(
    () => () => {
      if (activeSearchId.current) api.cancelRequest(activeSearchId.current);
    },
    [],
  );

  async function createTopic(input: KafkaTopicCreateInput): Promise<boolean> {
    if (!active) return false;
    setError(null);
    const created = await api.createKafkaTopic(active.id, input);
    if (created) {
      await reloadTopics(active.id);
      setSelectedTopic(input.topic);
      addToast(`Topic "${input.topic}" created`, "success");
    }
    return created;
  }

  async function removeTopic(topic: string): Promise<void> {
    if (!active) return;
    if (
      !window.confirm(`Delete topic "${topic}"? This action cannot be undone.`)
    )
      return;
    setError(null);
    try {
      await api.deleteKafkaTopic(active.id, topic);
      addToast(`Topic "${topic}" deleted`, "success");
      if (selectedTopic === topic) {
        setSelectedTopic("");
        setMessages([]);
        setTotalMessages(0);
      }
      await reloadTopics(active.id);
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  const openTopicDetail = useCallback(
    async (topic: string): Promise<void> => {
      if (!active) return;
      setDetailTopic(topic);
      setPartitions([]);
      setConsumerGroups([]);
      setLoadingDetail(true);
      setError(null);
      try {
        const [parts, groups] = await Promise.all([
          api.fetchKafkaTopicPartitions(active.id, topic),
          api.fetchKafkaConsumerGroups(active.id, topic),
        ]);
        setPartitions(parts);
        setConsumerGroups(groups);
      } catch (reason) {
        setError(errorMessage(reason));
      } finally {
        setLoadingDetail(false);
      }
    },
    [active],
  );

  async function produceMessage(
    input: KafkaMessageProduceInput,
  ): Promise<void> {
    if (!active) throw new Error("No Kafka connection selected");
    setError(null);
    await api.produceKafkaMessage(active.id, input);
    addToast(`Event sent to "${input.topic}"`, "success");
  }
  async function produceBatch(
    input: KafkaBatchProduceInput,
  ): Promise<{ sent: number; failed: number; errors: string[]; tookMs: number }> {
    if (!active) throw new Error("No Kafka connection selected");
    setError(null);
    const result = await api.produceKafkaBatch(active.id, input);
    addToast(
      `Batch sent: ${result.sent.toLocaleString()} messages in ${result.tookMs}ms`,
      "success",
    );
    return result;
  }

  const selectedProfile = useMemo(
    () => profiles.find((p) => p.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  useEffect(() => {
    localStorage.setItem("kafka-thrift-profiles", JSON.stringify(profiles));
  }, [profiles]);

  useEffect(() => {
    localStorage.setItem("kafka-thrift-selected-profile-id", selectedProfileId);
  }, [selectedProfileId]);

  useEffect(() => {
    localStorage.setItem("kafka-thrift-selected-struct", selectedStructName);
  }, [selectedStructName]);

  useEffect(() => {
    if (!selectedProfileId) {
      setProfileStructs([]);
      return;
    }
    const profile = profiles.find((p) => p.id === selectedProfileId);
    if (!profile) {
      setProfileStructs([]);
      return;
    }
    setLoadingProfileStructs(true);
    api
      .parseThriftIDL(profile.idl)
      .then((names) => {
        setProfileStructs(names);
        setSelectedStructName((prev) => {
          if (names.includes(prev)) return prev;
          return profile.structName && names.includes(profile.structName)
            ? profile.structName
            : names.length === 1
              ? names[0]
              : "";
        });
      })
      .catch(() => {
        setProfileStructs([]);
      })
      .finally(() => setLoadingProfileStructs(false));
  }, [selectedProfileId, profiles]);

  const paletteCommands = useKafkaPaletteCommands({
    connections,
    activeId,
    onSelectConnection: useCallback(
      (id: string) => {
        setActiveId(id);
        void reloadTopics(id);
      },
      [setActiveId, reloadTopics],
    ),
    viewMode,
    onSetViewMode: setViewMode,
    topics,
    visibleTopics,
    selectedTopic,
    onRefresh: useCallback(() => {
      if (!activeId) return;
      if (viewMode === "topics") void reloadTopics(activeId);
      else void reloadConsumerGroups(activeId);
    }, [activeId, viewMode, reloadTopics, reloadConsumerGroups]),
    onNewConnection: useCallback(() => setEditor(null), [setEditor]),
    onCreateTopic: useCallback(
      () => setCreatingTopic(true),
      [setCreatingTopic],
    ),
    onProduceMessage: useCallback(() => setProducing(true), [setProducing]),
    onOpenTopicDetail: useCallback(() => {
      if (selectedTopic) void openTopicDetail(selectedTopic);
    }, [selectedTopic, openTopicDetail]),
    onCopyAllTopics: useCallback(() => {
      void navigator.clipboard
        .writeText(topics.map((t) => t.name).join("\n"))
        .then(() => addToast("Copied all topic names to clipboard", "success"))
        .catch(() => addToast("Failed to copy topic names", "error"));
    }, [topics]),
    onCopyVisibleTopics: useCallback(() => {
      void navigator.clipboard
        .writeText(visibleTopics.map((t) => t.name).join("\n"))
        .then(() =>
          addToast("Copied visible topic names to clipboard", "success"),
        )
        .catch(() => addToast("Failed to copy topic names", "error"));
    }, [visibleTopics]),
    onBackToPicker: onClose,
  });

  return (
    <div className="app">
      <aside className="sidebar kafka-sidebar">
        <div className="sidebar-header">
          <span className="logo">◈</span> Kafka Browser
        </div>
        <button className="btn btn-block" onClick={onClose}>
          ← Product selection
        </button>
        <div className="sidebar-label">Kafka connections</div>
        <div className="conn-list">
          {connections.map((connection) => (
            <div
              key={connection.id}
              className={`conn-item${connection.id === activeId ? " active" : ""}`}
              onClick={() => {
                setActiveId(connection.id);
                void reloadTopics(connection.id);
              }}
            >
              <span
                className={`dot dot-${connection.id === activeId ? "green" : "unknown"}`}
              />
              <div className="conn-meta">
                <div className="conn-name">{connection.name}</div>
                <div className="conn-url">{connection.brokers}</div>
              </div>
              <div className="conn-actions">
                <button
                  title="Edit"
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditor(connection);
                  }}
                >
                  ✎
                </button>
                <button
                  title="Delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    void remove(connection);
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
          {connections.length === 0 && (
            <div className="conn-empty">No Kafka connections</div>
          )}
        </div>
        <button
          className="btn btn-primary btn-block"
          onClick={() => setEditor(null)}
        >
          + Add Kafka connection
        </button>
      </aside>

      <main className="workspace kafka-workspace">
        <header className="ws-header">
          <div className="ws-header-title">
            <h1 className="ws-title">{active?.name ?? "Kafka"}</h1>
            <div className="ws-sub">
              {active?.brokers ??
                "Add a connection to browse Kafka topics and messages."}
            </div>
          </div>
          {active && (
            <div className="ws-actions">
              <button
                className="btn"
                onClick={() =>
                  viewMode === "topics"
                    ? void reloadTopics(active.id)
                    : void reloadConsumerGroups(active.id)
                }
                disabled={
                  viewMode === "topics" ? loadingTopics : loadingConsumers
                }
              >
                {viewMode === "topics"
                  ? loadingTopics
                    ? "Loading…"
                    : "Refresh topics"
                  : loadingConsumers
                    ? "Loading…"
                    : "Refresh consumers"}
              </button>
            </div>
          )}
        </header>

        {error && (
          <div className="banner banner-error kafka-error">{error}</div>
        )}

        {!active ? (
          <div className="empty-state kafka-empty">
            <div className="empty-title">No Kafka connection selected</div>
            <div>
              Connect to a broker to browse topics and inspect recent events.
            </div>
            <button className="btn btn-primary" onClick={() => setEditor(null)}>
              + Add Kafka connection
            </button>
          </div>
        ) : (
          <div
            className={`kafka-content${viewMode === "consumers" ? " kafka-consumers-mode" : ""}`}
          >
            <section className="kafka-topics">
              <div className="kafka-section-heading">
                <h2>{viewMode === "topics" ? "Topics" : "Consumers"}</h2>
                <div className="kafka-topic-actions">
                  <span className="muted">
                    {viewMode === "topics"
                      ? topics.length
                      : `${consumerGroups.reduce((count, group) => count + group.members.length, 0)} consumers · ${consumerGroups.length} groups`}
                  </span>
                  {viewMode === "topics" && (
                    <button
                      className="btn"
                      onClick={() => setCreatingTopic(true)}
                    >
                      + Create
                    </button>
                  )}
                </div>
              </div>
              <div
                className="kafka-detail-tabs kafka-browser-tabs"
                role="tablist"
                aria-label="Kafka browser mode"
              >
                <button
                  className={`kafka-detail-tab${viewMode === "topics" ? " active" : ""}`}
                  role="tab"
                  aria-selected={viewMode === "topics"}
                  onClick={() => setViewMode("topics")}
                >
                  Topics
                </button>
                <button
                  className={`kafka-detail-tab${viewMode === "consumers" ? " active" : ""}`}
                  role="tab"
                  aria-selected={viewMode === "consumers"}
                  onClick={() => setViewMode("consumers")}
                >
                  Consumers
                </button>
              </div>
              <input
                className="input"
                aria-label={
                  viewMode === "topics"
                    ? "Filter topics"
                    : "Search consumer groups"
                }
                placeholder={
                  viewMode === "topics"
                    ? "Filter topics…"
                    : "Search groups, clients, topics…"
                }
                value={viewMode === "topics" ? topicFilter : consumerFilter}
                onChange={(event) =>
                  viewMode === "topics"
                    ? setTopicFilter(event.target.value)
                    : setConsumerFilter(event.target.value)
                }
              />
              {viewMode === "topics" ? (
                <div className="kafka-topic-list">
                  {visibleTopics.map((topic) => (
                    <div
                      key={topic.name}
                      className={`kafka-topic-row${selectedTopic === topic.name ? " active" : ""}`}
                    >
                      <span
                        className="topic-name"
                        onClick={() => void loadMessages(topic.name)}
                        title="Load messages"
                      >
                        {topic.name}
                      </span>
                      <span className="topic-meta muted">
                        {topic.partitions}p
                      </span>
                      <span className="topic-actions">
                        <button
                          title="Topic details"
                          onClick={() => void openTopicDetail(topic.name)}
                        >
                          ℹ
                        </button>
                        <button
                          title="Delete topic"
                          onClick={() => void removeTopic(topic.name)}
                        >
                          ✕
                        </button>
                      </span>
                    </div>
                  ))}
                  {!loadingTopics && topics.length === 0 && (
                    <div className="muted kafka-empty-topics">
                      No topics found
                    </div>
                  )}
                </div>
              ) : (
                <div className="kafka-topic-list kafka-consumer-list">
                  {visibleConsumerGroups.map((group) => (
                    <button
                      className={`kafka-consumer-row${selectedConsumerGroupId === group.groupId ? " active" : ""}`}
                      key={group.groupId}
                      onClick={() => setSelectedConsumerGroupId(group.groupId)}
                      title={group.groupId}
                    >
                      <span className="kafka-consumer-row-name">
                        {group.groupId}
                      </span>
                      <span className="kafka-consumer-row-meta">
                        <span
                          className={`group-state state-${group.state.toLowerCase()}`}
                        >
                          {group.state}
                        </span>
                        <span className="muted">
                          {group.members.length} members
                        </span>
                      </span>
                    </button>
                  ))}
                  {!loadingConsumers && consumerGroups.length === 0 && (
                    <div className="muted kafka-empty-topics">
                      No consumer groups found
                    </div>
                  )}
                  {!loadingConsumers &&
                    consumerGroups.length > 0 &&
                    visibleConsumerGroups.length === 0 && (
                      <div className="muted kafka-empty-topics">
                        No consumers match this search
                      </div>
                    )}
                  {loadingConsumers && (
                    <div className="muted kafka-empty-topics">
                      Loading consumers…
                    </div>
                  )}
                </div>
              )}
            </section>

            {viewMode === "consumers" ? (
              <section className="kafka-consumer-details">
                {loadingConsumers ? (
                  <div className="muted kafka-consumer-placeholder">
                    Loading consumers…
                  </div>
                ) : !selectedConsumerGroup ? (
                  <div className="muted kafka-consumer-placeholder">
                    {consumerGroups.length === 0
                      ? "No consumer groups found"
                      : "Select a consumer group to view its details"}
                  </div>
                ) : (
                  <>
                    <div className="kafka-consumer-detail-header">
                      <div>
                        <div className="muted kafka-consumer-eyebrow">
                          Consumer group
                        </div>
                        <h2 title={selectedConsumerGroup.groupId}>
                          {selectedConsumerGroup.groupId}
                        </h2>
                      </div>
                      <span
                        className={`group-state state-${selectedConsumerGroup.state.toLowerCase()}`}
                      >
                        {selectedConsumerGroup.state}
                      </span>
                    </div>
                    <div className="kafka-consumer-summary">
                      <div>
                        <span className="muted">Protocol</span>
                        <strong>{selectedConsumerGroup.protocol || "—"}</strong>
                      </div>
                      <div>
                        <span className="muted">Members</span>
                        <strong>{selectedConsumerGroup.members.length}</strong>
                      </div>
                      <div>
                        <span className="muted">Topics</span>
                        <strong>{selectedConsumerTopics.length}</strong>
                      </div>
                    </div>
                    <div className="kafka-consumer-detail-section">
                      <div className="kafka-section-heading">
                        <h3>Subscribed topics</h3>
                        <span className="muted">
                          {selectedConsumerTopics.length}
                        </span>
                      </div>
                      {selectedConsumerTopics.length > 0 ? (
                        <div className="kafka-consumer-topic-list">
                          {selectedConsumerTopics.map((topic) => (
                            <button
                              className="kafka-subscribed-topic"
                              key={topic}
                              title={`Open ${topic}`}
                              onClick={() => openSubscribedTopic(topic)}
                            >
                              {topic} <span aria-hidden="true">→</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="muted kafka-consumer-empty">
                          No active topic assignments
                        </div>
                      )}
                    </div>
                    <div className="kafka-consumer-detail-section">
                      <div className="kafka-section-heading">
                        <h3>Members</h3>
                        <span className="muted">
                          {selectedConsumerGroup.members.length}
                        </span>
                      </div>
                      {selectedConsumerGroup.members.length > 0 ? (
                        <div className="kafka-consumer-members">
                          {selectedConsumerGroup.members.map((member) => (
                            <div
                              className="kafka-consumer-member"
                              key={member.memberId}
                            >
                              <div className="kafka-consumer-member-info">
                                <span
                                  className="kafka-browser-member-name"
                                  title={member.clientId}
                                >
                                  {member.clientId || member.memberId}
                                </span>
                                <span
                                  className="muted kafka-browser-member-host"
                                  title={member.clientHost}
                                >
                                  {member.clientHost}
                                </span>
                              </div>
                              <span className="muted">
                                {member.assignments.reduce(
                                  (count, assignment) =>
                                    count + assignment.partitions.length,
                                  0,
                                )}{" "}
                                partitions
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="muted kafka-consumer-empty">
                          No active members
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            ) : (
              <section className="kafka-messages">
                <div className="kafka-message-tools">
                  <div className="kafka-tool-group">
                    <div className="kafka-tool-label">Load messages</div>
                    <div className="kafka-tool-controls">
                      <select
                        className="input kafka-mode"
                        aria-label="Message loading position"
                        value={fetchMode}
                        onChange={(event) => {
                          const mode = event.target.value;
                          if (
                            mode === "beginning" ||
                            mode === "end" ||
                            mode === "offset"
                          ) {
                            setFetchMode(mode);
                          }
                        }}
                        disabled={!selectedTopic || loadingMessages}
                      >
                        <option value="end">From end</option>
                        <option value="beginning">From beginning</option>
                        <option value="offset">From offset…</option>
                      </select>
                      {fetchMode === "offset" && (
                        <>
                          <select
                            className="input kafka-partition"
                            aria-label="Partition for offset"
                            value={offsetPartition}
                            onChange={(event) =>
                              setOffsetPartition(Number(event.target.value))
                            }
                            disabled={!selectedTopic || loadingMessages}
                          >
                            {Array.from(
                              {
                                length:
                                  topics.find(
                                    (item) => item.name === selectedTopic,
                                  )?.partitions ?? 0,
                              },
                              (_, partition) => (
                                <option key={partition} value={partition}>
                                  Partition {partition}
                                </option>
                              ),
                            )}
                          </select>
                          <input
                            className="input kafka-offset"
                            aria-label="Start offset"
                            inputMode="numeric"
                            placeholder="Offset"
                            value={messageOffset}
                            onChange={(event) =>
                              setMessageOffset(event.target.value)
                            }
                            disabled={!selectedTopic || loadingMessages}
                          />
                          <span className="muted kafka-offset-hint">
                            Offsets are per partition
                          </span>
                        </>
                      )}
                      <select
                        className="input kafka-limit"
                        aria-label="Maximum messages to load"
                        value={limit}
                        onChange={(event) =>
                          setLimit(Number(event.target.value))
                        }
                        disabled={!selectedTopic || loadingMessages}
                      >
                        {[10, 20, 50, 100].map((count) => (
                          <option key={count} value={count}>
                            {count} messages
                          </option>
                        ))}
                      </select>
                      <button
                        className="btn btn-primary"
                        onClick={() => void loadMessages()}
                        disabled={!selectedTopic || loadingMessages}
                      >
                        {loadingMessages ? "Loading…" : "Load"}
                      </button>
                    </div>
                  </div>
                  <div className="kafka-tool-group">
                    <div className="kafka-tool-label">Search</div>
                    <div className="kafka-tool-controls">
                      <input
                        className="input kafka-search-input"
                        placeholder="Filter loaded messages or search topic history…"
                        value={search}
                        onChange={(event) => {
                          cancelSearch();
                          setSearch(event.target.value);
                          setSearchResults(null);
                          setSearchScanned(0);
                        }}
                        disabled={!selectedTopic}
                      />
                      <button
                        className="btn"
                        onClick={() => void searchTopic()}
                        disabled={
                          !selectedTopic ||
                          !search.trim() ||
                          searching ||
                          loadingMessages
                        }
                      >
                        Search history
                      </button>
                      {searching && (
                        <button className="btn" onClick={cancelSearch}>
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="kafka-tool-group">
                    <div className="kafka-tool-label">Topic actions</div>
                    <div className="kafka-tool-controls">
                      <button
                        className="btn"
                        onClick={() =>
                          selectedTopic && void openTopicDetail(selectedTopic)
                        }
                        disabled={!selectedTopic}
                      >
                        Details
                      </button>
                      <button
                        className="btn"
                        onClick={() => setProducing(true)}
                        disabled={!selectedTopic}
                      >
                        Send event
                      </button>
                      <button
                        className="btn"
                        onClick={() => setBatchProducing(true)}
                        disabled={!selectedTopic}
                      >
                        Batch send
                      </button>
                    </div>
                  </div>
                  <div className="kafka-tool-group">
                    <div className="kafka-tool-label">Thrift decode</div>
                    <div className="kafka-tool-controls">
                      <button
                        className="btn"
                        onClick={() => setProfilesOpen(true)}
                      >
                        Decode profiles
                      </button>
                      <select
                        className="input kafka-profile-select"
                        value={selectedProfileId}
                        onChange={(event) =>
                          setSelectedProfileId(event.target.value)
                        }
                        disabled={!profiles.length}
                      >
                        <option value="">
                          {profiles.length ? "Select profile…" : "No profiles"}
                        </option>
                        {profiles.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {selectedProfileId && (
                        <select
                          className="input kafka-struct-select"
                          value={selectedStructName}
                          onChange={(event) =>
                            setSelectedStructName(event.target.value)
                          }
                          disabled={
                            !profileStructs.length || loadingProfileStructs
                          }
                        >
                          <option value="">
                            {loadingProfileStructs
                              ? "Parsing…"
                              : "Select struct…"}
                          </option>
                          {profileStructs.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                </div>
                <div className="kafka-section-heading">
                  <h2>{selectedTopic || "Select a topic"}</h2>
                  <span className="muted">
                    {loadingMessages
                      ? "Loading messages…"
                      : searchResults === null
                        ? `${visibleMessages.length} shown · ${totalMessages.toLocaleString()} available`
                        : `${visibleMessages.length} search results`}
                  </span>
                </div>
                {searchResults !== null && (
                  <div className="muted kafka-search-status">
                    {searching
                      ? "Searching full topic history"
                      : searchCancelled
                        ? "Search cancelled"
                        : "Search complete"}
                    {" · "}
                    {searchScanned.toLocaleString()} messages scanned
                    {" · "}
                    {searchResults.length} shown
                  </div>
                )}
                <div className="kafka-message-list">
                  {visibleMessages.map((message) => (
                    <KafkaMessageAccordion
                      key={`${message.topic}-${message.partition}-${message.offset}`}
                      message={message}
                      thriftIdl={selectedProfile?.idl ?? null}
                      structName={selectedStructName}
                      loadingProfile={loadingProfileStructs}
                    />
                  ))}
                  {selectedTopic &&
                    !loadingMessages &&
                    searchResults === null &&
                    messages.length === 0 && (
                      <div className="muted kafka-empty-messages">
                        No messages found at this position
                      </div>
                    )}
                  {searchResults !== null &&
                    !searching &&
                    visibleMessages.length === 0 && (
                      <div className="muted kafka-empty-messages">
                        No messages match this search
                      </div>
                    )}
                  {searchResults === null &&
                    messages.length > 0 &&
                    visibleMessages.length === 0 && (
                      <div className="muted kafka-empty-messages">
                        No messages match this search
                      </div>
                    )}
                </div>
              </section>
            )}
          </div>
        )}
      </main>
      {editor !== undefined && (
        <KafkaConnectionForm
          key={editor?.id ?? "new-kafka"}
          connection={editor}
          onClose={() => setEditor(undefined)}
          onSave={save}
        />
      )}
      {creatingTopic && (
        <KafkaTopicCreateDialog
          onClose={() => setCreatingTopic(false)}
          onCreate={createTopic}
        />
      )}
      {producing && selectedTopic && (
        <KafkaProduceDialog
          topic={selectedTopic}
          draft={produceDraft}
          profiles={profiles}
          onDraftChange={updateProduceDraft}
          onClose={() => setProducing(false)}
          onSend={produceMessage}
        />
      )}
      {batchProducing && selectedTopic && (
        <KafkaBatchSendDialog
          topic={selectedTopic}
          draft={batchDraft}
          profiles={profiles}
          onDraftChange={updateBatchProduceDraft}
          onClose={() => setBatchProducing(false)}
          onSend={produceBatch}
        />
      )}
      {profilesOpen && (
        <KafkaThriftProfilesDialog
          profiles={profiles}
          onChange={setProfiles}
          onClose={() => setProfilesOpen(false)}
        />
      )}
      {detailTopic && (
        <KafkaTopicDetailDialog
          topic={detailTopic}
          partitions={partitions}
          consumerGroups={consumerGroups}
          loading={loadingDetail}
          onClose={() => setDetailTopic(null)}
        />
      )}
      <CommandPalettePanel
        commands={paletteCommands}
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}

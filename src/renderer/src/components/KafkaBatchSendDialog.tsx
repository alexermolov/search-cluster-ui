import { useState } from "react";
import type { ThriftProfile } from "../../../shared/types";
import type { KafkaBatchProduceInput } from "../../../shared/ipc";
import { errorMessage } from "../api";
import { JsonEditor } from "./JsonEditor";
import { BatchSendHelpDialog } from "./BatchSendHelpDialog";

export type KafkaBatchProduceDraft = {
  key: string;
  format: "raw" | "json" | "thrift";
  value: string;
  thriftProfileId: string;
  count: number;
  threads: number;
  batchSize: number;
};

interface Props {
  topic: string;
  draft: KafkaBatchProduceDraft;
  profiles: ThriftProfile[];
  onDraftChange: (patch: Partial<KafkaBatchProduceDraft>) => void;
  onClose: () => void;
  onSend: (
    input: KafkaBatchProduceInput,
  ) => Promise<{ sent: number; failed: number; errors: string[]; tookMs: number }>;
}



export function KafkaBatchSendDialog({
  topic,
  draft,
  profiles,
  onDraftChange,
  onClose,
  onSend,
}: Props) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    sent: number;
    failed: number;
    errors: string[];
    tookMs: number;
  } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  async function submit(): Promise<void> {
    if (draft.count <= 0) {
      setError("Event count must be greater than 0");
      return;
    }
    if (draft.threads <= 0) {
      setError("Threads must be greater than 0");
      return;
    }
    if (draft.batchSize <= 0) {
      setError("Batch size must be greater than 0");
      return;
    }
    if (draft.format === "json" || draft.format === "thrift") {
      try {
        JSON.parse(draft.value);
      } catch {
        setError("Message value must be valid JSON");
        return;
      }
    }
    let profile: ThriftProfile | undefined;
    if (draft.format === "thrift") {
      if (!draft.thriftProfileId) {
        setError("Please select a Thrift profile");
        return;
      }
      profile = profiles.find((p) => p.id === draft.thriftProfileId);
      if (!profile) {
        setError("Selected Thrift profile not found");
        return;
      }
    }
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await onSend({
        topic,
        key: draft.key || null,
        value: draft.value,
        format: draft.format,
        thrift:
          draft.format === "thrift" && profile
            ? {
                idl: profile.idl,
                structName: profile.structName,
                protocol: profile.protocol,
              }
            : undefined,
        count: draft.count,
        threads: draft.threads,
        batchSize: draft.batchSize,
      });
      setResult(res);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
        <div className="modal kafka-action-modal kafka-produce-modal">
          <h2 style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span>Batch send to {topic}</span>
            <button
              className="btn btn-sm batch-help-btn"
              title="Variables help"
              onClick={() => setHelpOpen(true)}
            >
              ?
            </button>
          </h2>

        <div className="field-row">
          <label className="field">
            <span>Key (optional)</span>
            <input
              className="input mono"
              value={draft.key}
              onChange={(e) => onDraftChange({ key: e.target.value })}
              placeholder="Use ${i}, ${uuid}, ${randString(8)}, ${nowIso}, etc."
            />
          </label>
          <label className="field">
            <span>Format</span>
            <select
              className="input"
              value={draft.format}
              onChange={(e) =>
                onDraftChange({
                  format: e.target.value as KafkaBatchProduceDraft["format"],
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
              onChange={(e) => onDraftChange({ value: e.target.value })}
              rows={6}
              placeholder="Free-form text. Use ${i}, ${uuid}, ${randString(10)}, ${nowIso}, etc."
              style={{ minHeight: "120px", fontFamily: "monospace" }}
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
              placeholder='{"id": "${i}", "name": "${randName()}", "age": "${randInt(18,65)}"}'
              minHeight="120px"
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
                onChange={(e) =>
                  onDraftChange({ thriftProfileId: e.target.value })
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
              {draft.thriftProfileId &&
                (() => {
                  const p = profiles.find(
                    (x) => x.id === draft.thriftProfileId,
                  );
                  if (!p) return null;
                  return (
                    <span className="muted">
                      {p.structName} ·{" "}
                      {p.protocol === "compact"
                        ? "TCompactProtocol"
                        : "TBinaryProtocol"}
                    </span>
                  );
                })()}
            </label>
            <div className="field">
              <span>JSON payload (will be serialized to Thrift binary)</span>
              <JsonEditor
                value={draft.value}
                onChange={(value) => onDraftChange({ value })}
                onRun={() => void submit()}
                placeholder="Enter JSON matching the Thrift struct. Supports ${i}, ${uuid}, ${randName()}, etc."
                minHeight="120px"
              />
            </div>
          </>
        )}

        <div className="field-row">
          <label className="field">
            <span>Total events</span>
            <input
              className="input mono"
              type="number"
              min={1}
              max={10000000}
              value={draft.count}
              onChange={(e) =>
                onDraftChange({ count: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Threads</span>
            <input
              className="input mono"
              type="number"
              min={1}
              max={64}
              value={draft.threads}
              onChange={(e) =>
                onDraftChange({ threads: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            <span>Batch size</span>
            <input
              className="input mono"
              type="number"
              min={1}
              max={10000}
              value={draft.batchSize}
              onChange={(e) =>
                onDraftChange({ batchSize: Number(e.target.value) })
              }
            />
          </label>
        </div>

        {error && <div className="banner banner-error">{error}</div>}

        {result && (
          <div className="reindex-result">
            <div className="reindex-stats">
              <div className="card">
                <div className="card-label">Sent</div>
                <div className="card-value">
                  {result.sent.toLocaleString()}
                </div>
              </div>
              <div className="card">
                <div className="card-label">Failed</div>
                <div className="card-value">
                  {result.failed.toLocaleString()}
                </div>
              </div>
              <div className="card">
                <div className="card-label">Time</div>
                <div className="card-value">{result.tookMs} ms</div>
              </div>
              <div className="card">
                <div className="card-label">Throughput</div>
                <div className="card-value">
                  {result.tookMs > 0
                    ? Math.round(
                        (result.sent / result.tookMs) * 1000,
                      ).toLocaleString()
                    : "—"}{" "}
                  msg/s
                </div>
              </div>
            </div>
            {result.errors.length > 0 && (
              <div className="banner banner-error">
                {result.errors.length} error
                {result.errors.length === 1 ? "" : "s"}
                <pre
                  className="json"
                  style={{ maxHeight: 120, overflow: "auto" }}
                >
                  {result.errors.slice(0, 5).join("\n")}
                </pre>
              </div>
            )}
          </div>
        )}

        <div className="modal-footer">
          <span className="spacer" />
          {!result ? (
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
          ) : (
            <button className="btn" onClick={onClose}>
              Close
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={sending}
          >
            {sending ? "Sending…" : "Batch send"}
          </button>
        </div>
      </div>
      {helpOpen && <BatchSendHelpDialog onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

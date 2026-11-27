import { useState, useEffect, useCallback } from "react";
import type { ProtobufProfile } from "../../../shared/types";
import { api, errorMessage } from "../api";

interface Props {
  profiles: ProtobufProfile[];
  onChange: (profiles: ProtobufProfile[]) => void;
  onClose: () => void;
}

export function KafkaProtobufProfilesDialog({
  profiles,
  onChange,
  onClose,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [proto, setProto] = useState("");
  const [messages, setMessages] = useState<string[]>([]);
  const [messageName, setMessageName] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const editingProfile = editingId
    ? profiles.find((p) => p.id === editingId) ?? null
    : null;

  const parseProto = useCallback(async (value: string, preferredMessage?: string) => {
    if (!value.trim()) {
      setMessages([]);
      setParseError(null);
      return;
    }
    setParsing(true);
    setParseError(null);
    try {
      const names = await api.parseProtobufProto(value);
      setMessages(names);
      setMessageName((prev) => {
        if (names.includes(prev)) return prev;
        return preferredMessage && names.includes(preferredMessage)
          ? preferredMessage
          : names.length === 1
            ? names[0]
            : "";
      });
    } catch (e: unknown) {
      setMessages([]);
      setParseError(errorMessage(e));
    } finally {
      setParsing(false);
    }
  }, []);

  useEffect(() => {
    if (editingProfile) {
      setName(editingProfile.name);
      setProto(editingProfile.proto);
      setMessageName(editingProfile.messageName);
      setMessages([]);
      setParseError(null);
      void parseProto(editingProfile.proto, editingProfile.messageName);
    } else if (editingId === "") {
      setName("");
      setProto("");
      setMessageName("");
      setMessages([]);
      setParseError(null);
    }
  }, [editingId, editingProfile, parseProto]);

  function save() {
    if (!name.trim() || !proto.trim() || !messageName) return;
    const updated: ProtobufProfile = {
      id: editingProfile?.id ?? generateId(),
      name: name.trim(),
      proto: proto.trim(),
      messageName,
    };
    if (editingProfile) {
      onChange(profiles.map((p) => (p.id === editingProfile.id ? updated : p)));
    } else {
      onChange([...profiles, updated]);
    }
    setEditingId(null);
  }

  function remove(id: string) {
    onChange(profiles.filter((p) => p.id !== id));
    if (editingId === id) setEditingId(null);
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal kafka-profiles-modal">
        <h2>Protobuf profiles</h2>

        {profiles.length === 0 && editingId === null && (
          <div className="muted" style={{ padding: "12px 0" }}>
            No profiles yet. Click "New profile" to create one.
          </div>
        )}

        {profiles.length > 0 && editingId === null && (
          <div className="kafka-profiles-list">
            {profiles.map((profile) => (
              <div key={profile.id} className="kafka-profile-row">
                <div className="kafka-profile-info">
                  <strong>{profile.name}</strong>
                  <span className="muted">{profile.messageName}</span>
                </div>
                <div className="kafka-profile-actions">
                  <button
                    className="btn"
                    onClick={() => setEditingId(profile.id)}
                  >
                    Edit
                  </button>
                  <button
                    className="btn btn-danger"
                    onClick={() => remove(profile.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editingId !== null && (
          <div className="kafka-profile-form">
            <label className="field">
              <span>Name</span>
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Profile name"
              />
            </label>
            <label className="field">
              <span>Protobuf contract</span>
              <textarea
                className="input mono"
                value={proto}
                onChange={(event) => setProto(event.target.value)}
                onBlur={() => void parseProto(proto, messageName)}
                rows={8}
                placeholder={`syntax = "proto3";\nmessage User {\n  int32 id = 1;\n  string name = 2;\n}`}
                style={{
                  minHeight: "140px",
                  fontFamily: "monospace",
                  fontSize: "12px",
                }}
              />
            </label>
            <button
              className="btn"
              onClick={() => void parseProto(proto, messageName)}
              disabled={parsing || !proto.trim()}
            >
              {parsing ? "Parsing…" : "Parse messages"}
            </button>
            {parseError && (
              <div className="banner banner-error" style={{ marginTop: 4 }}>
                {parseError}
              </div>
            )}
            {messages.length > 0 && (
              <label className="field">
                <span>Message</span>
                <select
                  className="input"
                  value={messageName}
                  onChange={(event) => setMessageName(event.target.value)}
                >
                  <option value="">— Select —</option>
                  {messages.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditingId(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={save}
                disabled={!name.trim() || !proto.trim() || !messageName}
              >
                Save
              </button>
            </div>
          </div>
        )}

        {editingId === null && (
          <div className="modal-footer">
            <button className="btn" onClick={() => setEditingId("")}>
              New profile
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

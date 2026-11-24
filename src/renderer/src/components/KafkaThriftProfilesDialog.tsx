import { useState, useEffect, useCallback } from "react";
import type { ThriftProfile } from "../../../shared/types";
import { api, errorMessage } from "../api";

interface Props {
  profiles: ThriftProfile[];
  onChange: (profiles: ThriftProfile[]) => void;
  onClose: () => void;
}

export function KafkaThriftProfilesDialog({
  profiles,
  onChange,
  onClose,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [idl, setIdl] = useState("");
  const [structs, setStructs] = useState<string[]>([]);
  const [structName, setStructName] = useState("");
  const [protocol, setProtocol] = useState<"binary" | "compact">("binary");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const editingProfile = editingId
    ? profiles.find((p) => p.id === editingId) ?? null
    : null;

  const parseIdl = useCallback(async (value: string, preferredStruct?: string) => {
    if (!value.trim()) {
      setStructs([]);
      setParseError(null);
      return;
    }
    setParsing(true);
    setParseError(null);
    try {
      const names = await api.parseThriftIDL(value);
      setStructs(names);
      setStructName((prev) => {
        if (names.includes(prev)) return prev;
        return preferredStruct && names.includes(preferredStruct)
          ? preferredStruct
          : names.length === 1
            ? names[0]
            : "";
      });
    } catch (e: unknown) {
      setStructs([]);
      setParseError(errorMessage(e));
    } finally {
      setParsing(false);
    }
  }, []);

  useEffect(() => {
    if (editingProfile) {
      setName(editingProfile.name);
      setIdl(editingProfile.idl);
      setStructName(editingProfile.structName);
      setProtocol(editingProfile.protocol ?? "binary");
      setStructs([]);
      setParseError(null);
      void parseIdl(editingProfile.idl, editingProfile.structName);
    } else if (editingId === "") {
      setName("");
      setIdl("");
      setStructName("");
      setProtocol("binary");
      setStructs([]);
      setParseError(null);
    }
  }, [editingId, editingProfile, parseIdl]);

  function save() {
    if (!name.trim() || !idl.trim() || !structName) return;
    const updated: ThriftProfile = {
      id: editingProfile?.id ?? generateId(),
      name: name.trim(),
      idl: idl.trim(),
      structName,
      protocol,
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
        <h2>Thrift decode profiles</h2>

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
                  <span className="muted">{profile.structName} · {profile.protocol ?? 'binary'}</span>
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
              <span>Thrift IDL contract</span>
              <textarea
                className="input mono"
                value={idl}
                onChange={(event) => setIdl(event.target.value)}
                onBlur={() => void parseIdl(idl, structName)}
                rows={8}
                placeholder={`struct User {\n  1: required i32 id,\n  2: required string name\n}`}
                style={{
                  minHeight: "140px",
                  fontFamily: "monospace",
                  fontSize: "12px",
                }}
              />
            </label>
            <button
              className="btn"
              onClick={() => void parseIdl(idl, structName)}
              disabled={parsing || !idl.trim()}
            >
              {parsing ? "Parsing…" : "Parse structs"}
            </button>
            {parseError && (
              <div className="banner banner-error" style={{ marginTop: 4 }}>
                {parseError}
              </div>
            )}
            {structs.length > 0 && (
              <label className="field">
                <span>Struct / Exception / Union</span>
                <select
                  className="input"
                  value={structName}
                  onChange={(event) => setStructName(event.target.value)}
                >
                  <option value="">— Select —</option>
                  {structs.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Protocol</span>
              <select
                className="input"
                value={protocol}
                onChange={(event) => setProtocol(event.target.value as "binary" | "compact")}
              >
                <option value="binary">TBinaryProtocol</option>
                <option value="compact">TCompactProtocol</option>
              </select>
            </label>
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditingId(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={save}
                disabled={!name.trim() || !idl.trim() || !structName}
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

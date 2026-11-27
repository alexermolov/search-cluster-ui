import { useState, useEffect } from "react";
import type { AvroProfile } from "../../../shared/types";
import { api, errorMessage } from "../api";

interface Props {
  profiles: AvroProfile[];
  onChange: (profiles: AvroProfile[]) => void;
  onClose: () => void;
}

export function KafkaAvroProfilesDialog({
  profiles,
  onChange,
  onClose,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [schema, setSchema] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  const editingProfile = editingId
    ? profiles.find((p) => p.id === editingId) ?? null
    : null;

  useEffect(() => {
    if (editingProfile) {
      setName(editingProfile.name);
      setSchema(editingProfile.schema);
      setParseError(null);
    } else if (editingId === "") {
      setName("");
      setSchema("");
      setParseError(null);
    }
  }, [editingId, editingProfile]);

  async function tryParse(value: string) {
    if (!value.trim()) {
      setParseError(null);
      return;
    }
    setParsing(true);
    setParseError(null);
    try {
      await api.parseAvroSchema(value);
      setParseError(null);
    } catch (e: unknown) {
      setParseError(errorMessage(e));
    } finally {
      setParsing(false);
    }
  }

  function save() {
    if (!name.trim() || !schema.trim()) return;
    const updated: AvroProfile = {
      id: editingProfile?.id ?? generateId(),
      name: name.trim(),
      schema: schema.trim(),
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
        <h2>Avro profiles</h2>

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
                  <span className="muted">Avro schema</span>
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
              <span>Avro schema (JSON)</span>
              <textarea
                className="input mono"
                value={schema}
                onChange={(event) => setSchema(event.target.value)}
                onBlur={() => void tryParse(schema)}
                rows={8}
                placeholder={`{\n  "type": "record",\n  "name": "User",\n  "fields": [\n    { "name": "id", "type": "long" },\n    { "name": "name", "type": "string" }\n  ]\n}`}
                style={{
                  minHeight: "140px",
                  fontFamily: "monospace",
                  fontSize: "12px",
                }}
              />
            </label>
            <button
              className="btn"
              onClick={() => void tryParse(schema)}
              disabled={parsing || !schema.trim()}
            >
              {parsing ? "Validating…" : "Validate schema"}
            </button>
            {parseError && (
              <div className="banner banner-error" style={{ marginTop: 4 }}>
                {parseError}
              </div>
            )}
            <div className="modal-footer">
              <button className="btn" onClick={() => setEditingId(null)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={save}
                disabled={!name.trim() || !schema.trim() || !!parseError}
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

import { useState, useEffect } from "react";

interface Props {
  title?: string;
  onImport: (base64: string) => void;
  onClose: () => void;
}

export function ImportDialog({ title = "Import connection", onImport, onClose }: Props) {
  const [value, setValue] = useState("");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        handleImport();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, value]);

  function handleImport() {
    const trimmed = value.trim();
    if (!trimmed) {
      onClose();
      return;
    }
    onImport(trimmed);
    onClose();
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <h2>{title}</h2>
        <div className="field">
          <span>Paste base64-encoded connection config</span>
          <textarea
            className="input"
            rows={6}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste shared connection string here"
            autoFocus
          />
        </div>
        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleImport}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}

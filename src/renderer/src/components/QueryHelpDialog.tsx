import { useCallback } from "react";
import ReactMarkdown from "react-markdown";
import helpContent from "../assets/query-help.md?raw";

interface Props {
  onClose: () => void;
}

export function QueryHelpDialog({ onClose }: Props) {
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  return (
    <div className="modal-backdrop" onMouseDown={handleBackdropClick}>
      <div className="modal help-modal">
        <h2>Elasticsearch Query DSL — справка</h2>
        <div className="help-content">
          <ReactMarkdown>{helpContent}</ReactMarkdown>
        </div>
        <div className="modal-footer">
          <span className="spacer" />
          <button className="btn btn-primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

import { useState } from 'react'
import type { ExportOptions } from '../../../shared/ipc'
import { api, errorMessage } from '../api'

interface Props {
  connectionId: string
  index: string
  body: Record<string, unknown> | null
  /** Top-level _source fields discovered from the current results. */
  availableColumns: string[]
  onClose: () => void
  /** Fired when the export request starts. */
  onStart: () => void
  /** Success callback: resolved file path (null when the save dialog was cancelled). */
  onExported: (path: string | null) => void
  /** Failure callback: error message to show as a banner. */
  onError: (msg: string) => void
}

/**
 * Export dialog: format (CSV/JSON), optional flattening and column
 * selection for CSV. The export itself runs in the main process
 * (PIT/scroll + native save dialog).
 */
export function ExportDialog({
  connectionId,
  index,
  body,
  availableColumns,
  onClose,
  onStart,
  onExported,
  onError,
}: Props) {
  const [format, setFormat] = useState<'csv' | 'json'>('csv')
  const [flatten, setFlatten] = useState(false)
  // null — all columns selected; otherwise the explicit selection.
  const [selected, setSelected] = useState<string[] | null>(null)
  const [exporting, setExporting] = useState(false)

  function toggleColumn(col: string): void {
    setSelected((prev) => {
      const current = prev ?? availableColumns
      const next = current.includes(col) ? current.filter((c) => c !== col) : [...current, col]
      // All checked again — back to the "everything" mode.
      return next.length === availableColumns.length ? null : next
    })
  }

  async function exportResults(): Promise<void> {
    if (exporting) return
    setExporting(true)
    onStart()
    const options: ExportOptions | undefined =
      format === 'csv' ? { columns: selected, flatten } : undefined
    try {
      const path = await api.exportSearch(connectionId, { index, body }, format, options)
      onExported(path)
      onClose()
    } catch (e) {
      onError(errorMessage(e))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal doc-modal">
        <h2>
          Export <span className="mono muted">{index}</span>
        </h2>

        <div className="export-format">
          <button
            className={format === 'csv' ? 'btn btn-primary' : 'btn'}
            onClick={() => setFormat('csv')}
          >
            CSV
          </button>
          <button
            className={format === 'json' ? 'btn btn-primary' : 'btn'}
            onClick={() => setFormat('json')}
          >
            JSON
          </button>
        </div>

        {format === 'csv' && (
          <>
            <label className="export-cols-label">
              <input
                type="checkbox"
                checked={flatten}
                onChange={(e) => setFlatten(e.target.checked)}
              />
              Flatten nested fields (a.b.c)
            </label>

            <div className="export-heading">Columns</div>
            {availableColumns.length === 0 ? (
              <div className="muted">
                No fields in current results — all discovered fields will be exported
              </div>
            ) : (
              <div className="export-cols">
                {availableColumns.map((col) => (
                  <label key={col}>
                    <input
                      type="checkbox"
                      checked={(selected ?? availableColumns).includes(col)}
                      onChange={() => toggleColumn(col)}
                    />
                    {col}
                  </label>
                ))}
              </div>
            )}
          </>
        )}

        <div className="modal-footer">
          <span className="muted">Exports every matching document, not just this page</span>
          <span className="spacer" />
          <button className="btn" onClick={onClose} disabled={exporting}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void exportResults()}
            disabled={exporting}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
      </div>
    </div>
  )
}

import type { SearchHit } from './types'

/**
 * CSV helpers shared by the main-process exporters and the renderer
 * (export dialog column preview). Dependency-free on purpose so both
 * process sides can import it.
 */

/**
 * Recursively flatten a nested object into dotted keys (a.b.c).
 * Primitives stay as they are; arrays of primitives are joined with ', ';
 * anything else is JSON-stringified. Cycles are cut with a WeakSet.
 */
export function flattenObject(
  obj: Record<string, unknown>,
  prefix = '',
  seen?: WeakSet<object>,
): Record<string, string | number | boolean | null> {
  const visited = seen ?? new WeakSet<object>()
  const out: Record<string, string | number | boolean | null> = {}
  if (visited.has(obj)) return out // cycle guard
  visited.add(obj)
  for (const [key, value] of Object.entries(obj)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (value === null || value === undefined) {
      out[name] = null
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        out[name] = ''
      } else if (value.every((v) => v === null || typeof v !== 'object')) {
        out[name] = value.map((v) => (v === null || v === undefined ? '' : String(v))).join(', ')
      } else {
        out[name] = JSON.stringify(value)
      }
    } else if (typeof value === 'object') {
      Object.assign(out, flattenObject(value as Record<string, unknown>, name, visited))
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[name] = value
    } else {
      // bigint / symbol / function — stringify for CSV safety.
      out[name] = String(value)
    }
  }
  return out
}

/**
 * Union of _source field names across hits, first occurrence wins.
 * With flatten: dotted paths from flattenObject; otherwise top-level keys.
 * _index/_id are not included — the caller adds them.
 */
export function collectColumns(
  hits: { _source?: Record<string, unknown> | null }[],
  flatten: boolean,
): string[] {
  const cols: string[] = []
  for (const h of hits) {
    const source = h._source
    if (!source) continue
    const keys = flatten ? Object.keys(flattenObject(source)) : Object.keys(source)
    for (const key of keys) {
      if (!cols.includes(key)) cols.push(key)
    }
  }
  return cols
}

/** One CSV cell: objects are stringified, quotes/commas/newlines escaped. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'object' ? (JSON.stringify(v) ?? '') : String(v)
  if (s === '') return ''
  // Excel formula-injection guard.
  const safe = /^[=+\-@\t]/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/**
 * Serialize hits as CSV. Columns are _index, _id plus either the explicit
 * selection (opts.columns, when non-empty) or the union of discovered
 * _source fields (flattened to dotted paths when opts.flatten).
 */
export function hitsToCsv(
  hits: SearchHit[],
  opts?: { columns?: string[] | null; flatten?: boolean },
): string {
  const flatten = opts?.flatten ?? false
  const cols: string[] = [
    '_index',
    '_id',
    ...(opts?.columns && opts.columns.length > 0 ? opts.columns : collectColumns(hits, flatten)),
  ]
  const lines = [cols.map(csvCell).join(',')]
  for (const h of hits) {
    const flat = flatten ? flattenObject(h._source ?? {}) : null
    lines.push(
      cols
        .map((c) =>
          csvCell(c === '_index' ? h._index : c === '_id' ? h._id : flat ? flat[c] : h._source?.[c]),
        )
        .join(','),
    )
  }
  // BOM so Excel opens UTF-8 correctly; CRLF for widest compatibility.
  return '\ufeff' + lines.join('\r\n') + '\r\n'
}

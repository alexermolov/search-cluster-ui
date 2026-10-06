import type { IndexInfo } from '../../../shared/types'

export function HealthBadge({ status }: { status: string | null }) {
  const cls = status === 'green' || status === 'yellow' || status === 'red' ? status : 'unknown'
  return <span className={`badge badge-${cls}`}>{status ?? 'unknown'}</span>
}

export const fmtPct = (v: number | null): string => (v === null ? '—' : `${v}%`)

/** Parse a _cat size string ("2.5gb", "512mb", "100b") into bytes. */
export function parseSize(s: string): number {
  const m = /^([\d.]+)\s*([kmgt]?b?)$/i.exec(s.trim())
  if (!m) return 0
  const n = Number(m[1])
  if (!Number.isFinite(n)) return 0
  const unit = m[2].toLowerCase()
  const mult =
    unit === 'kb' ? 1e3 : unit === 'mb' ? 1e6 : unit === 'gb' ? 1e9 : unit === 'tb' ? 1e12 : 1
  return n * mult
}

/** Format bytes in a human-readable form (1 KB base, 1 decimal place). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`
}

/** Human-readable store size for an index row; falls back to the raw string. */
export function fmtStoreSize(index: IndexInfo): string {
  const bytes = parseSize(index.storeSize)
  return bytes > 0 ? formatBytes(bytes) : index.storeSize
}

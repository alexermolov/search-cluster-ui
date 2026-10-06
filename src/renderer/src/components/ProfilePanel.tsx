/* eslint-disable @typescript-eslint/no-explicit-any */

import type { ReactNode } from 'react'

interface Props {
  /** result.raw.profile — the per-shard profiling section of a search response. */
  profile: unknown
}

/** Format time_in_nanos as ms, or µs for sub-millisecond values. */
function fmtNanos(nanos: number): string {
  const ms = nanos / 1e6
  if (ms < 1) return `${(nanos / 1e3).toFixed(0)}µs`
  return `${ms.toFixed(1)}ms`
}

/** Recursively render a query-phase tree node (description + time + children). */
function PhaseTree({ phase }: { phase: any }): ReactNode {
  if (phase === null || typeof phase !== 'object') return null
  const description = typeof phase.description === 'string' ? phase.description : String(phase.description ?? '')
  const nanos = typeof phase.time_in_nanos === 'number' ? phase.time_in_nanos : null
  const children = Array.isArray(phase.children) ? phase.children : []
  return (
    <div>
      <div className="profile-row">
        <span className="profile-desc">{description}</span>
        <span className="profile-time">{nanos != null ? fmtNanos(nanos) : '—'}</span>
      </div>
      {children.length > 0 && (
        <div className="profile-children">
          {children.map((child: any, i: number) => (
            <PhaseTree key={i} phase={child} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Query profile view: per-shard timings from the "profile": true search
 * response section. Defensive parsing throughout — the shape comes straight
 * from the cluster and varies between versions.
 */
export function ProfilePanel({ profile }: Props) {
  if (profile == null) {
    return (
      <div className="muted">
        Profile not enabled — add "profile": true to the query or toggle Profile in the toolbar
      </div>
    )
  }

  const shards = Array.isArray((profile as any)?.shards) ? (profile as any).shards : []
  const totalTook = shards.reduce(
    (sum: number, s: any) => sum + (typeof s?.took === 'number' ? s.took : 0),
    0,
  )

  return (
    <div className="profile">
      <div className="profile-summary muted">
        {shards.length} shard{shards.length === 1 ? '' : 's'} · took {totalTook}ms total
      </div>
      {shards.map((shard: any, i: number) => {
        const id = shard?.id != null ? String(shard.id) : '—'
        const node = typeof shard?.node === 'string' && shard.node !== '' ? shard.node : '—'
        const took = typeof shard?.took === 'number' ? shard.took : null
        const searches = Array.isArray(shard?.searches) ? shard.searches : []
        return (
          <details key={i} className="section" open={i === 0}>
            <summary className="section-title">
              shard {id} · node {node} · took {took != null ? `${took}ms` : '—'}
            </summary>
            {searches.map((search: any, j: number) => {
              const query = Array.isArray(search?.query) ? search.query : []
              const collectors = Array.isArray(search?.collector) ? search.collector : []
              const rewriteTime =
                typeof search?.rewrite_time === 'number' ? search.rewrite_time : null
              return (
                <div key={j}>
                  {query.map((phase: any, k: number) => (
                    <PhaseTree key={k} phase={phase} />
                  ))}
                  {rewriteTime != null && (
                    <div className="profile-row">
                      <span className="profile-desc">rewrite_time</span>
                      <span className="profile-time">{fmtNanos(rewriteTime)}</span>
                    </div>
                  )}
                  {collectors.map((collector: any, k: number) => {
                    const name = typeof collector?.name === 'string' ? collector.name : 'collector'
                    const reason =
                      typeof collector?.reason === 'string' ? collector.reason : 'unknown reason'
                    const nanos =
                      typeof collector?.time_in_nanos === 'number' ? collector.time_in_nanos : null
                    return (
                      <div key={k} className="profile-row">
                        <span className="profile-desc">
                          {name}: {reason}
                        </span>
                        <span className="profile-time">{nanos != null ? fmtNanos(nanos) : '—'}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </details>
        )
      })}
    </div>
  )
}

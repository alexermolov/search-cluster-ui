import type {
  ClusterFlavor,
  ClusterHealth,
  ClusterInfo,
  ClusterSettings,
  ComponentTemplateInfo,
  DataStreamBackingIndex,
  DataStreamInfo,
  IlmIndexStatus,
  IlmPolicyInfo,
  IndexDetail,
  IndexTemplateInfo,
  IndexInfo,
  NodeInfo,
  Overview,
  SearchResults,
  SearchHit,
  ShardInfo,
  SnapshotInfo,
  SnapshotRepository,
  BulkResult,
  MsearchResults,
} from '../../shared/types'
import { ApiError } from './http'
import type { ClusterHttp } from './http'

/**
 * Transport-agnostic cluster client. Elasticsearch and OpenSearch share the
 * same REST surface, so almost everything lives here; flavor-specific classes
 * override the divergent bits (version parsing, plugin endpoints, ...).
 *
 * To add a capability: add a method here, a channel in src/shared/ipc.ts,
 * and a handler in src/main/ipc.ts.
 */
export interface ClusterClient {
  ping(signal?: AbortSignal): Promise<ClusterInfo>
  overview(signal?: AbortSignal): Promise<Overview>
  indices(signal?: AbortSignal): Promise<IndexInfo[]>
  indexDetail(indexName: string, signal?: AbortSignal): Promise<IndexDetail>
  search(
    index: string,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<SearchResults>
  /** POST /{index}/_explain/{docId} — score explanation for one document. */
  explain(
    index: string,
    docId: string,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>
  deleteIndex(indexName: string): Promise<void>
  clearIndex(indexName: string): Promise<{ deleted: number; failures: unknown[] }>
  deleteDocument(indexName: string, docId: string): Promise<void>
  getDocument(
    indexName: string,
    docId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>
  saveDocument(
    indexName: string,
    docId: string,
    source: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  createDocument(
    indexName: string,
    source: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  bulk(index: string | null, ndjson: string, signal?: AbortSignal): Promise<BulkResult>
  msearch(index: string | null, ndjson: string, signal?: AbortSignal): Promise<MsearchResults>
  /** All hits of a query via PIT+search_after or scroll (capped); used for export. */
  searchAll(
    index: string,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
    maxHits?: number,
  ): Promise<SearchHit[]>
  openIndex(indexName: string): Promise<void>
  closeIndex(indexName: string): Promise<void>
  addAlias(indexName: string, alias: string): Promise<void>
  removeAlias(indexName: string, alias: string): Promise<void>
  reindex(
    source: string,
    dest: string,
    body: Record<string, unknown> | null,
  ): Promise<Record<string, unknown>>
  shards(signal?: AbortSignal): Promise<ShardInfo[]>
  snapshots(signal?: AbortSignal): Promise<SnapshotInfo[]>
  repositories(signal?: AbortSignal): Promise<SnapshotRepository[]>
  createSnapshot(
    repository: string,
    snapshot: string,
    indices: string[],
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>
  deleteSnapshot(repository: string, snapshot: string): Promise<void>
  restoreSnapshot(
    repository: string,
    snapshot: string,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>
  /** POST /_cluster/allocation/explain — why a shard cannot be allocated. */
  allocationExplain(
    index: string | null,
    shard: number | null,
    primary: boolean | null,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>
  /** POST /_cluster/reroute — manual shard allocation commands. */
  reroute(
    commands: Record<string, unknown>[],
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>
  clusterSettings(signal?: AbortSignal): Promise<ClusterSettings>
  updateClusterSettings(
    persistent: Record<string, unknown> | null,
    transient: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<ClusterSettings>
  indexTemplates(signal?: AbortSignal): Promise<IndexTemplateInfo[]>
  componentTemplates(signal?: AbortSignal): Promise<ComponentTemplateInfo[]>
  saveIndexTemplate(name: string, body: Record<string, unknown>): Promise<void>
  deleteIndexTemplate(name: string): Promise<void>
  saveComponentTemplate(name: string, body: Record<string, unknown>): Promise<void>
  deleteComponentTemplate(name: string): Promise<void>
  /** POST /_index_template/{name}/_simulate_index/{index?} — preview the resulting index config. */
  simulateIndexTemplate(
    templateName: string,
    indexName: string | null,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>>
  /** PUT /{index} — create an index; matching templates are applied by the cluster. */
  createIndexFromTemplate(
    indexName: string,
    body: Record<string, unknown> | null,
  ): Promise<void>
  /** Lifecycle policies (ILM by default; OpenSearch overrides with ISM). */
  ilmPolicies(signal?: AbortSignal): Promise<IlmPolicyInfo[]>
  /** Lifecycle status of indices with a policy attached (ILM/ISM explain). */
  ilmExplain(signal?: AbortSignal): Promise<IlmIndexStatus[]>
  dataStreams(signal?: AbortSignal): Promise<DataStreamInfo[]>
  close(): void
}

const NODE_FIELDS = 'name,ip,version,roles,role,heap.percent,ram.percent,disk.used_percent'
const INDEX_FIELDS = 'health,status,index,docs.count,docs.deleted,store.size,pri,rep,uuid'
const SHARD_FIELDS = 'index,shard,prirep,state,docs,store,ip,node'
const SNAPSHOT_FIELDS =
  'id,repository,status,indices,start_time,start_time_millis,end_time,end_time_millis,duration'

// Legacy single-letter codes returned by `_cat/nodes` (h=role) on old clusters.
const ROLE_ABBR: Record<string, string> = {
  c: 'coordinating',
  d: 'data',
  f: 'frozen',
  i: 'ingest',
  l: 'ml',
  m: 'master',
  r: 'remote_cluster_client',
  s: 'search',
  t: 'transform',
  v: 'voting_only',
  w: 'warm',
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function parseRoles(row: any): string[] {
  const roles = row?.roles
  if (Array.isArray(roles)) return roles.map(String)
  const legacy = typeof row?.role === 'string' ? row.role : ''
  return legacy.split('').map((ch: string) => ROLE_ABBR[ch] ?? ch).filter(Boolean)
}

function extractTotal(total: any): number | null {
  if (total === null || total === undefined) return null
  if (typeof total === 'number') return total
  if (typeof total === 'object' && typeof total.value === 'number') return total.value
  return null
}

export abstract class BaseClusterClient implements ClusterClient {
  constructor(
    protected readonly http: ClusterHttp,
    protected readonly flavor: ClusterFlavor,
  ) {}

  async ping(signal?: AbortSignal): Promise<ClusterInfo> {
    return this.parseInfo(await this.http.request<Record<string, any>>('GET', '/', undefined, signal))
  }

  async overview(signal?: AbortSignal): Promise<Overview> {
    const [info, health, nodes] = await Promise.all([
      this.ping(signal),
      this.health(signal),
      this.nodes(signal),
    ])
    return { info, health, nodes }
  }

  async indices(signal?: AbortSignal): Promise<IndexInfo[]> {
    const rows = await this.http.request<any[]>(
      'GET',
      `/_cat/indices?format=json&h=${INDEX_FIELDS}`,
      undefined,
      signal,
    )
    return (rows ?? [])
      .map((r) => ({
        name: String(r.index ?? ''),
        health: (r.health ?? null) as IndexInfo['health'],
        status: r.status === 'close' ? ('close' as const) : ('open' as const),
        docsCount: numOrNull(r['docs.count']),
        docsDeleted: numOrNull(r['docs.deleted']),
        storeSize: String(r['store.size'] ?? '0b'),
        primaryShards: Number(r.pri ?? 0),
        replicas: Number(r.rep ?? 0),
        uuid: String(r.uuid ?? ''),
      }))
      .filter((i) => i.name !== '')
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async indexDetail(indexName: string, signal?: AbortSignal): Promise<IndexDetail> {
    const raw = await this.http.request<Record<string, any>>(
      'GET',
      `/${encodeURIComponent(indexName)}`,
      undefined,
      signal,
    )
    const entry = raw?.[indexName] ?? Object.values(raw ?? {})[0] ?? {}
    return {
      name: indexName,
      aliases: entry.aliases ?? {},
      mappings: entry.mappings ?? {},
      settings: entry.settings ?? {},
    }
  }

  async search(
    index: string,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<SearchResults> {
    const res = await this.http.request<any>(
      'POST',
      `/${encodeURIComponent(index)}/_search`,
      body ?? { size: 10 },
      signal,
    )
    return {
      total: extractTotal(res?.hits?.total),
      hits: this.parseHits(res),
      raw: (res ?? {}) as Record<string, unknown>,
    }
  }

  async explain(
    index: string,
    docId: string,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const res = await this.http.request<any>(
      'POST',
      `/${encodeURIComponent(index)}/_explain/${encodeURIComponent(docId)}`,
      body ?? { query: { match_all: {} } },
      signal,
    )
    return (res ?? {}) as Record<string, unknown>
  }

  private parseHits(res: any): SearchHit[] {
    const hits = Array.isArray(res?.hits?.hits) ? res.hits.hits : []
    return hits.map((h: any) => ({
      _index: String(h?._index ?? ''),
      _id: String(h?._id ?? ''),
      _score: h?._score ?? null,
      _source: (h?._source ?? {}) as Record<string, unknown>,
      highlight: (h?.highlight ?? undefined) as Record<string, string[]> | undefined,
    }))
  }

  async deleteIndex(indexName: string): Promise<void> {
    const res = await this.http.request<any>('DELETE', `/${encodeURIComponent(indexName)}`)
    if (res?.acknowledged === false) throw new Error('Cluster did not acknowledge')
  }

  async clearIndex(indexName: string): Promise<{ deleted: number; failures: unknown[] }> {
    const res = await this.http.request<any>(
      'POST',
      `/${encodeURIComponent(indexName)}/_delete_by_query?refresh=wait_for`,
      { query: { match_all: {} } },
    )
    if (res?.failures && Array.isArray(res.failures) && res.failures.length > 0) {
      throw new Error(`Delete by query failed with ${res.failures.length} failures`)
    }
    return { deleted: res?.deleted ?? 0, failures: res?.failures ?? [] }
  }

  async deleteDocument(indexName: string, docId: string): Promise<void> {
    const res = await this.http.request<any>(
      'DELETE',
      `/${encodeURIComponent(indexName)}/_doc/${encodeURIComponent(docId)}?refresh=wait_for`,
    )
    if (res?.result === 'not_found') throw new Error('Document not found')
  }

  async getDocument(
    indexName: string,
    docId: string,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const res = await this.http.request<any>(
      'GET',
      `/${encodeURIComponent(indexName)}/_doc/${encodeURIComponent(docId)}`,
      undefined,
      signal,
    )
    if (res?.found === false) throw new Error(`Document "${docId}" not found`)
    return (res?._source ?? {}) as Record<string, unknown>
  }

  async saveDocument(
    indexName: string,
    docId: string,
    source: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.http.request<any>(
      'PUT',
      `/${encodeURIComponent(indexName)}/_doc/${encodeURIComponent(docId)}`,
      source,
    )
  }

  async createDocument(
    indexName: string,
    source: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.http.request<any>('POST', `/${encodeURIComponent(indexName)}/_doc`, source)
  }

  async bulk(index: string | null, ndjson: string, signal?: AbortSignal): Promise<BulkResult> {
    const path = index ? `/${encodeURIComponent(index)}/_bulk` : '/_bulk'
    const res = await this.http.request<any>('POST', path, ndjson, signal, 'application/x-ndjson')
    const items = Array.isArray(res?.items) ? res.items : []
    return {
      took: numOrNull(res?.took),
      errors: Boolean(res?.errors),
      items: items.map((it: any) => {
        const action = Object.keys(it ?? {})[0] ?? 'unknown'
        const op = it?.[action] ?? {}
        return {
          action,
          index: op._index != null ? String(op._index) : null,
          id: op._id != null ? String(op._id) : null,
          status: numOrNull(op.status),
          result: op.result != null ? String(op.result) : null,
          error: (op.error ?? null) as Record<string, unknown> | null,
        }
      }),
    }
  }

  async msearch(index: string | null, ndjson: string, signal?: AbortSignal): Promise<MsearchResults> {
    const path = index ? `/${encodeURIComponent(index)}/_msearch` : '/_msearch'
    const res = await this.http.request<any>('POST', path, ndjson, signal, 'application/x-ndjson')
    const responses = Array.isArray(res?.responses) ? res.responses : []
    return {
      took: numOrNull(res?.took),
      responses: responses.map((r: any) => {
        const hits = Array.isArray(r?.hits?.hits) ? r.hits.hits : []
        return {
          status: numOrNull(r?.status) ?? 200,
          hits: hits.map((h: any) => ({
            _index: String(h._index ?? ''),
            _id: String(h._id ?? ''),
            _score: numOrNull(h._score),
            _source: (h._source ?? {}) as Record<string, unknown>,
            highlight: h.highlight as Record<string, string[]> | undefined,
          })),
          total: extractTotal(r?.hits?.total),
          raw: (r ?? {}) as Record<string, unknown>,
        }
      }),
    }
  }

  async searchAll(
    index: string,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
    maxHits = 100_000,
  ): Promise<SearchHit[]> {
    // Prefer PIT + search_after (ES 7.10+/8+, OpenSearch). Fall back to
    // scroll only when the _pit endpoint itself is unavailable.
    let pitId: unknown = null
    try {
      const pitRes = await this.http.request<any>(
        'POST',
        `/${encodeURIComponent(index)}/_pit?keep_alive=2m`,
        undefined,
        signal,
      )
      pitId = pitRes?.id ?? null
    } catch (e) {
      if (e instanceof ApiError) return this.searchAllViaScroll(index, body, signal, maxHits)
      throw e
    }
    if (pitId == null) return this.searchAllViaScroll(index, body, signal, maxHits)
    try {
      return await this.searchViaPit(pitId, body, signal, maxHits)
    } finally {
      // Best-effort cleanup; the PIT also expires on its own.
      void this.http.request('DELETE', '/_pit', { id: pitId }).catch(() => {})
    }
  }

  private async searchViaPit(
    pitId: unknown,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
    maxHits = 100_000,
  ): Promise<SearchHit[]> {
    const PAGE = 1000
    // Keep the user's sort when present; _shard_doc must come last so
    // search_after has a total order across shards.
    const userSort = body?.sort
    const sort = Array.isArray(userSort)
      ? [...userSort, { _shard_doc: 'asc' }]
      : [{ _shard_doc: 'asc' }]
    const all: SearchHit[] = []
    let searchAfter: unknown[] | null = null
    while (all.length < maxHits) {
      const res: any = await this.http.request<any>(
        'POST',
        '/_search',
        {
          ...(body ?? {}),
          size: PAGE,
          pit: { id: pitId, keep_alive: '2m' },
          sort,
          ...(searchAfter != null ? { search_after: searchAfter } : {}),
        },
        signal,
      )
      const hits = this.parseHits(res)
      if (hits.length === 0) break
      all.push(...hits.slice(0, maxHits - all.length))
      const rawHits: any = res?.hits?.hits
      const lastSort: unknown = Array.isArray(rawHits)
        ? rawHits[rawHits.length - 1]?.sort
        : undefined
      if (!Array.isArray(lastSort) || lastSort.length === 0) break
      searchAfter = lastSort
    }
    return all
  }

  private async searchAllViaScroll(
    index: string,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
    maxHits = 100_000,
  ): Promise<SearchHit[]> {
    const PAGE = 1000
    const first = await this.http.request<any>(
      'POST',
      `/${encodeURIComponent(index)}/_search?scroll=2m`,
      { ...(body ?? {}), size: PAGE },
      signal,
    )
    const all = this.parseHits(first)
    let scrollId: unknown = first?._scroll_id
    try {
      while (scrollId != null && all.length < maxHits) {
        const res = await this.http.request<any>(
          'POST',
          '/_search/scroll',
          { scroll: '2m', scroll_id: scrollId },
          signal,
        )
        const hits = this.parseHits(res)
        if (hits.length === 0) break
        all.push(...hits.slice(0, maxHits - all.length))
        scrollId = res?._scroll_id ?? scrollId
      }
    } finally {
      if (scrollId != null) {
        // Best-effort cleanup; the scroll context also expires on its own.
        void this.http.request('DELETE', '/_search/scroll', { scroll_id: scrollId }).catch(() => {})
      }
    }
    return all
  }

  async openIndex(indexName: string): Promise<void> {
    const res = await this.http.request<any>(
      'POST',
      `/${encodeURIComponent(indexName)}/_open`,
    )
    if (res?.acknowledged === false) throw new Error('Cluster did not acknowledge')
  }

  async closeIndex(indexName: string): Promise<void> {
    const res = await this.http.request<any>(
      'POST',
      `/${encodeURIComponent(indexName)}/_close`,
    )
    if (res?.acknowledged === false) throw new Error('Cluster did not acknowledge')
  }

  async addAlias(indexName: string, alias: string): Promise<void> {
    const res = await this.http.request<any>('POST', '/_aliases', {
      actions: [{ add: { index: indexName, alias } }],
    })
    if (res?.acknowledged === false) throw new Error('Cluster did not acknowledge')
  }

  async removeAlias(indexName: string, alias: string): Promise<void> {
    const res = await this.http.request<any>('POST', '/_aliases', {
      actions: [{ remove: { index: indexName, alias } }],
    })
    if (res?.acknowledged === false) throw new Error('Cluster did not acknowledge')
  }

  async reindex(
    source: string,
    dest: string,
    body: Record<string, unknown> | null,
  ): Promise<Record<string, unknown>> {
    const res = await this.http.request<any>('POST', '/_reindex', {
      source: { index: source },
      dest: { index: dest },
      ...(body ?? {}),
    })
    return (res ?? {}) as Record<string, unknown>
  }

  async shards(signal?: AbortSignal): Promise<ShardInfo[]> {
    const rows = await this.http.request<any[]>(
      'GET',
      `/_cat/shards?format=json&h=${SHARD_FIELDS}`,
      undefined,
      signal,
    )
    return (rows ?? [])
      .map((r) => ({
        index: String(r.index ?? ''),
        shard: String(r.shard ?? ''),
        type: r.prirep === 'r' ? ('r' as const) : ('p' as const),
        state: String(r.state ?? ''),
        docs: numOrNull(r.docs),
        store: String(r.store ?? ''),
        ip: String(r.ip ?? ''),
        node: String(r.node ?? 'UNASSIGNED'),
      }))
      .filter((s) => s.index !== '')
      .sort((a, b) => {
        const byIndex = a.index.localeCompare(b.index)
        if (byIndex !== 0) return byIndex
        const byShard = (Number(a.shard) || 0) - (Number(b.shard) || 0)
        if (byShard !== 0) return byShard
        // primaries first
        return a.type === b.type ? 0 : a.type === 'p' ? -1 : 1
      })
  }

  async snapshots(signal?: AbortSignal): Promise<SnapshotInfo[]> {
    // _cat/snapshots requires a repository in the path; discover them first.
    const repos = await this.http.request<Record<string, any>>('GET', '/_snapshot', undefined, signal)
    const names = Object.keys(repos ?? {})
    if (names.length === 0) return []

    const perRepo = await Promise.all(
      names.map(async (repo) => {
        try {
          const rows = await this.http.request<any[]>(
            'GET',
            `/_cat/snapshots/${encodeURIComponent(repo)}?format=json&h=${SNAPSHOT_FIELDS}`,
            undefined,
            signal,
          )
          return (rows ?? []).map((r) => ({
            snapshot: String(r.id ?? ''),
            repository: repo,
            status: String(r.status ?? ''),
            indices: Array.isArray(r.indices) ? r.indices.join(', ') : String(r.indices ?? ''),
            startTime: String(r.start_time ?? ''),
            endTime: String(r.end_time ?? ''),
            duration: String(r.duration ?? ''),
            startMillis: numOrNull(r.start_time_millis),
          }))
        } catch {
          return [] // best-effort: skip repositories we cannot list
        }
      }),
    )

    return perRepo
      .flat()
      .filter((s) => s.snapshot !== '')
      .sort((a, b) => {
        if (a.startMillis !== null && b.startMillis !== null && a.startMillis !== b.startMillis) {
          return b.startMillis - a.startMillis
        }
        return a.snapshot.localeCompare(b.snapshot)
      })
  }

  async repositories(signal?: AbortSignal): Promise<SnapshotRepository[]> {
    const repos = await this.http.request<Record<string, any>>(
      'GET',
      '/_snapshot',
      undefined,
      signal,
    )
    return Object.entries(repos ?? {}).map(([id, v]) => ({
      id,
      type: String(v?.type ?? 'unknown'),
    }))
  }

  async createSnapshot(
    repository: string,
    snapshot: string,
    indices: string[],
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const merged: Record<string, unknown> = { ...(body ?? {}) }
    // No indices field = all indices (the cluster default).
    if (indices.length > 0) merged.indices = indices
    return this.http.request<Record<string, unknown>>(
      'PUT',
      `/_snapshot/${encodeURIComponent(repository)}/${encodeURIComponent(snapshot)}?wait_for_completion=false`,
      merged,
      signal,
    )
  }

  async deleteSnapshot(repository: string, snapshot: string): Promise<void> {
    await this.http.request(
      'DELETE',
      `/_snapshot/${encodeURIComponent(repository)}/${encodeURIComponent(snapshot)}`,
    )
  }

  async restoreSnapshot(
    repository: string,
    snapshot: string,
    body: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.http.request<Record<string, unknown>>(
      'POST',
      `/_snapshot/${encodeURIComponent(repository)}/${encodeURIComponent(snapshot)}/_restore?wait_for_completion=false`,
      body ?? {},
      signal,
    )
  }

  async allocationExplain(
    index: string | null,
    shard: number | null,
    primary: boolean | null,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    // A full target explains that specific shard; without one the cluster
    // picks the first unassigned shard (and errors when there is none).
    const body =
      index !== null && shard !== null && primary !== null ? { index, shard, primary } : {}
    return this.http.request<Record<string, unknown>>(
      'POST',
      '/_cluster/allocation/explain',
      body,
      signal,
    )
  }

  async reroute(
    commands: Record<string, unknown>[],
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    return this.http.request<Record<string, unknown>>(
      'POST',
      '/_cluster/reroute?metric=none',
      { commands },
      signal,
    )
  }

  async clusterSettings(signal?: AbortSignal): Promise<ClusterSettings> {
    const res = await this.http.request<any>('GET', '/_cluster/settings', undefined, signal)
    return {
      persistent: (res?.persistent ?? {}) as Record<string, unknown>,
      transient: (res?.transient ?? {}) as Record<string, unknown>,
    }
  }

  async updateClusterSettings(
    persistent: Record<string, unknown> | null,
    transient: Record<string, unknown> | null,
    signal?: AbortSignal,
  ): Promise<ClusterSettings> {
    const body: Record<string, unknown> = {}
    if (persistent) body.persistent = persistent
    if (transient) body.transient = transient
    const res = await this.http.request<any>('PUT', '/_cluster/settings', body, signal)
    return {
      persistent: (res?.persistent ?? {}) as Record<string, unknown>,
      transient: (res?.transient ?? {}) as Record<string, unknown>,
    }
  }

  async indexTemplates(signal?: AbortSignal): Promise<IndexTemplateInfo[]> {
    try {
      const res = await this.http.request<Record<string, any>>(
        'GET',
        '/_index_template',
        undefined,
        signal,
      )
      return Object.entries(res ?? {})
        .map(([name, t]) => ({
          name,
          indexPatterns: Array.isArray(t?.index_patterns) ? t.index_patterns.map(String) : [],
          priority: numOrNull(t?.priority),
          order: null,
          composedOf: Array.isArray(t?.composed_of) ? t.composed_of.map(String) : [],
          dataStream: t?.data_stream != null ? Boolean(t.data_stream) : null,
          version: numOrNull(t?.version),
          body: {
            index_patterns: t?.index_patterns ?? [],
            ...(t?.priority != null ? { priority: t.priority } : {}),
            ...(t?.composed_of != null ? { composed_of: t.composed_of } : {}),
            ...(t?.data_stream != null ? { data_stream: t.data_stream } : {}),
            ...(t?.version != null ? { version: t.version } : {}),
            ...(t?.template != null ? { template: t.template } : {}),
          },
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    } catch (e) {
      // Old clusters without composable templates: fall back to legacy /_template.
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
        return this.legacyIndexTemplates(signal)
      }
      throw e
    }
  }

  private async legacyIndexTemplates(signal?: AbortSignal): Promise<IndexTemplateInfo[]> {
    const res = await this.http.request<Record<string, any>>(
      'GET',
      '/_template',
      undefined,
      signal,
    )
    return Object.entries(res ?? {})
      .map(([name, t]) => ({
        name,
        indexPatterns: Array.isArray(t?.index_patterns) ? t.index_patterns.map(String) : [],
        priority: null,
        order: numOrNull(t?.order),
        composedOf: [],
        dataStream: null,
        version: numOrNull(t?.version),
        body: (t ?? {}) as Record<string, unknown>,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async componentTemplates(signal?: AbortSignal): Promise<ComponentTemplateInfo[]> {
    const res = await this.http.request<Record<string, any>>(
      'GET',
      '/_component_template',
      undefined,
      signal,
    )
    return Object.entries(res ?? {})
      .map(([name, t]) => ({ name, body: (t ?? {}) as Record<string, unknown> }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async saveIndexTemplate(name: string, body: Record<string, unknown>): Promise<void> {
    const res = await this.http.request<any>(
      'PUT',
      `/_index_template/${encodeURIComponent(name)}`,
      body,
    )
    if (res?.acknowledged === false) throw new Error('Cluster did not acknowledge')
  }

  async deleteIndexTemplate(name: string): Promise<void> {
    await this.http.request(
      'DELETE',
      `/_index_template/${encodeURIComponent(name)}`,
    )
  }

  async saveComponentTemplate(name: string, body: Record<string, unknown>): Promise<void> {
    const res = await this.http.request<any>(
      'PUT',
      `/_component_template/${encodeURIComponent(name)}`,
      body,
    )
    if (res?.acknowledged === false) throw new Error('Cluster did not acknowledge')
  }

  async deleteComponentTemplate(name: string): Promise<void> {
    await this.http.request(
      'DELETE',
      `/_component_template/${encodeURIComponent(name)}`,
    )
  }

  async simulateIndexTemplate(
    templateName: string,
    indexName: string | null,
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const suffix = indexName ? `/${encodeURIComponent(indexName)}` : ''
    const res = await this.http.request<any>(
      'POST',
      `/_index_template/${encodeURIComponent(templateName)}/_simulate_index${suffix}`,
      undefined,
      signal,
    )
    return (res ?? {}) as Record<string, unknown>
  }

  async createIndexFromTemplate(
    indexName: string,
    body: Record<string, unknown> | null,
  ): Promise<void> {
    const res = await this.http.request<any>(
      'PUT',
      `/${encodeURIComponent(indexName)}`,
      body ?? {},
    )
    if (res?.acknowledged === false) throw new Error('Cluster did not acknowledge')
  }

  async dataStreams(signal?: AbortSignal): Promise<DataStreamInfo[]> {
    let res: any
    try {
      res = await this.http.request<any>('GET', '/_data_stream', undefined, signal)
    } catch (e) {
      // Old clusters without data stream support.
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) return []
      throw e
    }
    const streams: any[] = Array.isArray(res?.data_streams) ? res.data_streams : []
    const mapped: DataStreamInfo[] = streams.map((ds: any) => {
        const raw = Array.isArray(ds?.indices) ? ds.indices : []
        const backing: DataStreamBackingIndex[] = raw.map((i: any) => ({
            indexName: String(i?.index_name ?? ''),
            generation: numOrNull(i?.generation),
            writeIndex: false,
            status: i?.status != null ? String(i.status) : null,
          }))
        const indices: DataStreamBackingIndex[] = backing
          .filter((i) => i.indexName !== '')
          .sort((a, b) => (a.generation ?? 0) - (b.generation ?? 0))
        // The highest generation backing index accepts writes.
        const maxGen = indices.reduce((m, i) => Math.max(m, i.generation ?? 0), -1)
        for (const i of indices) if (i.generation === maxGen) i.writeIndex = true
        return {
          name: String(ds?.name ?? ''),
          timestampField:
            ds?.timestamp_field?.name != null ? String(ds.timestamp_field.name) : null,
          generation: numOrNull(ds?.generation),
          status: ds?.status != null ? String(ds.status) : null,
          indices,
        }
      })
      return mapped.filter((ds) => ds.name !== '').sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Elasticsearch ILM policies; OpenSearch overrides this with ISM. */
  async ilmPolicies(signal?: AbortSignal): Promise<IlmPolicyInfo[]> {
    const res = await this.http.request<Record<string, any>>(
      'GET',
      '/_ilm/policy',
      undefined,
      signal,
    )
    const policies: Record<string, any> = res ?? {}
    return Object.entries(policies)
      .map(([name, p]: [string, any]) => ({
        name,
        phases: Object.keys(p?.policy?.phases ?? {}),
        body: (p ?? {}) as Record<string, unknown>,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  /** Elasticsearch ILM explain; OpenSearch overrides this with ISM. */
  async ilmExplain(signal?: AbortSignal): Promise<IlmIndexStatus[]> {
    const res = await this.http.request<Record<string, any>>(
      'GET',
      '/_ilm/explain',
      undefined,
      signal,
    )
    const explain: Record<string, any> = res?.indices ?? res ?? {}
    return Object.entries(explain)
      .filter(([, v]: [string, any]) => v?.policy != null)
      .map(([index, v]: [string, any]) => ({
        index,
        policy: v?.policy != null ? String(v.policy) : null,
        phase: v?.phase != null ? String(v.phase) : null,
        action: v?.action != null ? String(v.action) : null,
        step: v?.step != null ? String(v.step) : null,
        age: v?.phase_time != null ? String(v.phase_time) : null,
        failedStep: v?.failed_step != null ? String(v.failed_step) : null,
      }))
      .sort((a, b) => a.index.localeCompare(b.index))
  }

  close(): void {
    this.http.close()
  }

  /** Hook: derive the cluster identity from GET /. */
  protected parseInfo(root: Record<string, any>): ClusterInfo {
    return {
      clusterName: root?.cluster_name ?? 'unknown',
      clusterUuid: String(root?.cluster_uuid ?? ''),
      version: String(root?.version?.number ?? 'unknown'),
      flavor: this.flavor,
      distribution: root?.version?.distribution ?? this.flavor,
    }
  }

  private async health(signal?: AbortSignal): Promise<ClusterHealth> {
    const h = await this.http.request<any>('GET', '/_cluster/health', undefined, signal)
    return {
      status: (h?.status ?? 'red') as ClusterHealth['status'],
      numberOfNodes: Number(h?.number_of_nodes ?? 0),
      numberOfDataNodes: Number(h?.number_of_data_nodes ?? 0),
      activeShards: Number(h?.active_shards ?? 0),
      unassignedShards: Number(h?.unassigned_shards ?? 0),
      relocatingShards: Number(h?.relocating_shards ?? 0),
      initializingShards: Number(h?.initializing_shards ?? 0),
      delayedUnassignedShards: Number(h?.delayed_unassigned_shards ?? 0),
      pendingTasks: Number(h?.number_of_pending_tasks ?? 0),
      timedOut: Boolean(h?.timed_out),
    }
  }

  private async nodes(signal?: AbortSignal): Promise<NodeInfo[]> {
    const rows = await this.http.request<any[]>(
      'GET',
      `/_cat/nodes?format=json&h=${NODE_FIELDS}`,
      undefined,
      signal,
    )
    return (rows ?? []).map((r) => ({
      name: String(r.name ?? ''),
      version: String(r.version ?? ''),
      ip: String(r.ip ?? ''),
      roles: parseRoles(r),
      heapPercent: numOrNull(r['heap.percent']),
      ramPercent: numOrNull(r['ram.percent']),
      diskPercent: numOrNull(r['disk.used_percent']),
    }))
  }
}

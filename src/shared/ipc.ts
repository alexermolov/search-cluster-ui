import type {
  AuthConfig,
  ComponentTemplateInfo,
  DataStreamInfo,
  IlmIndexStatus,
  IlmPolicyInfo,
  IndexTemplateInfo,
  ClusterFlavor,
  ClusterInfo,
  ClusterSettings,
  IndexDetail,
  IndexInfo,
  Overview,
  SearchResults,
  ShardInfo,
  SnapshotInfo,
  SnapshotRepository,
  StoredConnection,
  BulkResult,
  MsearchResults,
} from './types'

/**
 * Single source of truth for the IPC surface: channel names + the typed API
 * exposed to the renderer through the preload bridge.
 */

export const IPC = {
  RequestCancel: 'request:cancel',
  ConnectionsList: 'connections:list',
  ConnectionsSave: 'connections:save',
  ConnectionsDelete: 'connections:delete',
  ConnectionsTest: 'connections:test',
  ClusterOverview: 'cluster:overview',
  ClusterIndices: 'cluster:indices',
  ClusterIndexDetail: 'cluster:index-detail',
  ClusterSearch: 'cluster:search',
  ClusterExplain: 'cluster:explain',
  ClusterIndexDelete: 'cluster:index-delete',
  ClusterIndexClear: 'cluster:index-clear',
  ClusterDocumentDelete: 'cluster:document-delete',
  ClusterDocumentGet: 'cluster:document-get',
  ClusterDocumentSave: 'cluster:document-save',
  ClusterDocumentCreate: 'cluster:document-create',
  ClusterBulk: 'cluster:bulk',
  ClusterExport: 'cluster:export',
  ClusterIndexOpen: 'cluster:index-open',
  ClusterIndexClose: 'cluster:index-close',
  ClusterAliasAdd: 'cluster:alias-add',
  ClusterAliasRemove: 'cluster:alias-remove',
  ClusterReindex: 'cluster:reindex',
  ClusterShards: 'cluster:shards',
  ClusterSnapshots: 'cluster:snapshots',
  ClusterRepositories: 'cluster:repositories',
  ClusterSnapshotCreate: 'cluster:snapshot-create',
  ClusterSnapshotDelete: 'cluster:snapshot-delete',
  ClusterSnapshotRestore: 'cluster:snapshot-restore',
  ClusterAllocationExplain: 'cluster:allocation-explain',
  ClusterReroute: 'cluster:reroute',
  ClusterSettingsGet: 'cluster:settings-get',
  ClusterSettingsUpdate: 'cluster:settings-update',
  ClusterIndexTemplates: 'cluster:index-templates',
  ClusterComponentTemplates: 'cluster:component-templates',
  ClusterIndexTemplateSave: 'cluster:index-template-save',
  ClusterIndexTemplateDelete: 'cluster:index-template-delete',
  ClusterComponentTemplateSave: 'cluster:component-template-save',
  ClusterComponentTemplateDelete: 'cluster:component-template-delete',
  ClusterSimulateIndexTemplate: 'cluster:simulate-index-template',
  ClusterCreateIndexFromTemplate: 'cluster:create-index-from-template',
  ClusterIlmPolicies: 'cluster:ilm-policies',
  ClusterIlmExplain: 'cluster:ilm-explain',
  ClusterDataStreams: 'cluster:data-streams',
  ClusterMsearch: 'cluster:msearch',
} as const

/** Payload shape for creating or updating a connection. */
export interface SaveConnectionInput {
  /** Present when editing an existing connection. */
  id?: string
  name: string
  url: string
  flavor: ClusterFlavor
  auth: AuthConfig
  tlsVerify: boolean
  timeoutMs: number
}

export interface SearchInput {
  index: string
  body: Record<string, unknown> | null
}

/** Payload for the _explain API: score explanation for one document. */
export interface ExplainInput {
  index: string
  docId: string
  body: Record<string, unknown> | null
}

/** CSV export options: explicit column selection and flattening. */
export interface ExportOptions {
  /** null/undefined — all discovered columns. */
  columns?: string[] | null
  /** Flatten nested _source into dotted keys (a.b.c). */
  flatten?: boolean
}

/** Payload for a _bulk import. */
export interface BulkInput {
  /** Default index in the _bulk path; action lines may override with _index. */
  index: string | null
  /** NDJSON: action/source line pairs. */
  ndjson: string
}

/** Payload for a _msearch multi-search. */
export interface MsearchInput {
  /** Optional index prefix for the _msearch path; null = /_msearch. */
  index: string | null
  /** NDJSON: alternating header/action lines. */
  ndjson: string
}

/** Payload for creating a snapshot in a repository. */
export interface SnapshotCreateInput {
  repository: string
  snapshot: string
  /** Empty array = all indices (cluster default). */
  indices: string[]
  /** Extra options merged into the request body (ignore_unavailable, ...). */
  body: Record<string, unknown> | null
}

export interface SnapshotRestoreInput {
  repository: string
  snapshot: string
  /** Full restore body (indices, rename_pattern, include_global_state, ...). */
  body: Record<string, unknown> | null
}

/** Target shard for /_cluster/allocation/explain; nulls = let the cluster pick. */
export interface AllocationExplainInput {
  index: string | null
  shard: number | null
  primary: boolean | null
}

/** Manual reroute commands (allocate / move / cancel / ...). */
export interface RerouteInput {
  commands: Record<string, unknown>[]
}

/** Cluster settings update; null sections are not sent. */
export interface SettingsUpdateInput {
  persistent: Record<string, unknown> | null
  transient: Record<string, unknown> | null
}

/**
 * AbortSignal does not survive structured clone over IPC, so the renderer
 * passes an opaque requestId with cancellable calls and can cancel it later
 * through the request:cancel channel.
 */
export interface CancelInput {
  requestId: string
}

export interface ElectronApi {
  /** Cancel an in-flight cluster request started with the same requestId. */
  cancelRequest(requestId: string): void
  listConnections(): Promise<StoredConnection[]>
  saveConnection(input: SaveConnectionInput): Promise<StoredConnection>
  deleteConnection(id: string): Promise<void>
  /** Cheap liveness check: GET / and return the cluster identity. */
  testConnection(input: SaveConnectionInput): Promise<ClusterInfo>
  fetchOverview(connectionId: string, requestId?: string): Promise<Overview>
  fetchIndices(connectionId: string, requestId?: string): Promise<IndexInfo[]>
  fetchIndexDetail(connectionId: string, indexName: string, requestId?: string): Promise<IndexDetail>
  search(connectionId: string, input: SearchInput, requestId?: string): Promise<SearchResults>
  /** POST /{index}/_explain/{docId} — score explanation for one document. */
  explain(
    connectionId: string,
    input: ExplainInput,
    requestId?: string,
  ): Promise<Record<string, unknown>>
  deleteIndex(connectionId: string, indexName: string): Promise<void>
  clearIndex(connectionId: string, indexName: string): Promise<{ deleted: number; failures: unknown[] }>
  deleteDocument(connectionId: string, indexName: string, docId: string): Promise<void>
  getDocument(
    connectionId: string,
    indexName: string,
    docId: string,
    requestId?: string,
  ): Promise<Record<string, unknown>>
  /** PUT /{index}/_doc/{id} — full replace of the document source. */
  saveDocument(
    connectionId: string,
    indexName: string,
    docId: string,
    source: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  /** POST /{index}/_doc — create with a cluster-generated ID. */
  createDocument(
    connectionId: string,
    indexName: string,
    source: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  bulk(connectionId: string, input: BulkInput): Promise<BulkResult>
  /**
   * Scroll-export every page of a query to a file chosen in a native save
   * dialog. Resolves to the saved file path, or null when cancelled.
   */
  exportSearch(
    connectionId: string,
    input: SearchInput,
    format: 'csv' | 'json',
    options?: ExportOptions,
    requestId?: string,
  ): Promise<string | null>
  openIndex(connectionId: string, indexName: string): Promise<void>
  closeIndex(connectionId: string, indexName: string): Promise<void>
  addAlias(connectionId: string, indexName: string, alias: string): Promise<void>
  removeAlias(connectionId: string, indexName: string, alias: string): Promise<void>
  reindex(
    connectionId: string,
    source: string,
    dest: string,
    body: Record<string, unknown> | null,
  ): Promise<Record<string, unknown>>
  fetchShards(connectionId: string, requestId?: string): Promise<ShardInfo[]>
  fetchSnapshots(connectionId: string, requestId?: string): Promise<SnapshotInfo[]>
  fetchRepositories(connectionId: string, requestId?: string): Promise<SnapshotRepository[]>
  createSnapshot(
    connectionId: string,
    input: SnapshotCreateInput,
  ): Promise<Record<string, unknown>>
  deleteSnapshot(connectionId: string, repository: string, snapshot: string): Promise<void>
  restoreSnapshot(
    connectionId: string,
    input: SnapshotRestoreInput,
  ): Promise<Record<string, unknown>>
  /** POST /_cluster/allocation/explain — why a shard cannot be allocated. */
  allocationExplain(
    connectionId: string,
    input: AllocationExplainInput,
    requestId?: string,
  ): Promise<Record<string, unknown>>
  /** POST /_cluster/reroute — manual shard allocation commands. */
  reroute(connectionId: string, input: RerouteInput): Promise<Record<string, unknown>>
  fetchClusterSettings(connectionId: string, requestId?: string): Promise<ClusterSettings>
  updateClusterSettings(
    connectionId: string,
    input: SettingsUpdateInput,
  ): Promise<ClusterSettings>
  /** GET /_index_template (with legacy /_template fallback). */
  indexTemplates(connectionId: string, requestId?: string): Promise<IndexTemplateInfo[]>
  /** GET /_component_template. */
  componentTemplates(connectionId: string, requestId?: string): Promise<ComponentTemplateInfo[]>
  /** PUT /_index_template/{name} — create or replace an index template. */
  saveIndexTemplate(
    connectionId: string,
    name: string,
    body: Record<string, unknown>,
  ): Promise<void>
  /** DELETE /_index_template/{name}. */
  deleteIndexTemplate(connectionId: string, name: string): Promise<void>
  /** PUT /_component_template/{name} — create or replace a component template. */
  saveComponentTemplate(
    connectionId: string,
    name: string,
    body: Record<string, unknown>,
  ): Promise<void>
  /** DELETE /_component_template/{name}. */
  deleteComponentTemplate(connectionId: string, name: string): Promise<void>
  /**
   * POST /_index_template/{name}/_simulate_index/{index?} — preview the
   * settings/mappings/aliases a template would apply to a new index.
   */
  simulateIndexTemplate(
    connectionId: string,
    templateName: string,
    indexName?: string,
    requestId?: string,
  ): Promise<Record<string, unknown>>
  /**
   * PUT /{index} — create an index; a matching index template is applied by
   * the cluster automatically.
   */
  createIndexFromTemplate(
    connectionId: string,
    indexName: string,
    body: Record<string, unknown> | null,
  ): Promise<void>
  /** Lifecycle policies: ILM (Elasticsearch) or ISM (OpenSearch). */
  ilmPolicies(connectionId: string, requestId?: string): Promise<IlmPolicyInfo[]>
  /** Lifecycle status of all indices with a policy attached (ILM/ISM explain). */
  ilmExplain(connectionId: string, requestId?: string): Promise<IlmIndexStatus[]>
  /** GET /_data_stream — data streams with their backing indices. */
  dataStreams(connectionId: string, requestId?: string): Promise<DataStreamInfo[]>
  msearch(connectionId: string, input: MsearchInput, requestId?: string): Promise<MsearchResults>
}

declare global {
  interface Window {
    api: ElectronApi
  }
}

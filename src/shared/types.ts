export type ClusterFlavor = 'elasticsearch' | 'opensearch'

export type KafkaSaslMechanism = 'plain' | 'scram-sha-256' | 'scram-sha-512'

export type KafkaAuthConfig =
  | { mechanism: 'plain'; username: string; password: string }
  | { mechanism: 'scram-sha-256'; username: string; password: string }
  | { mechanism: 'scram-sha-512'; username: string; password: string }

export interface KafkaTlsConfig {
  enabled: boolean
  rejectUnauthorized: boolean
  ca: string
  cert: string
  key: string
  passphrase: string
}

export interface KafkaConnectionInput {
  id?: string
  name: string
  brokers: string
  auth: KafkaAuthConfig | null
  tls: KafkaTlsConfig
  timeoutMs: number
}

export interface StoredKafkaConnection extends Omit<KafkaConnectionInput, 'id'> {
  id: string
  createdAt: number
  updatedAt: number
}

export interface KafkaTopicInfo {
  name: string
  partitions: number
}

export interface KafkaMessage {
  topic: string
  partition: number
  offset: string
  timestamp: string | null
  key: string | null
  value: string | null
  headers: Record<string, string | null>
}

export type RedisTopology = 'standalone' | 'cluster' | 'sentinel'

export interface RedisTlsConfig {
  enabled: boolean
  rejectUnauthorized: boolean
  ca: string
  cert: string
  key: string
}

export interface RedisConnectionInput {
  id?: string
  name: string
  topology: RedisTopology
  host: string
  port: number
  db: number
  nodes: string
  masterName: string
  username: string
  password: string
  sentinelUsername: string
  sentinelPassword: string
  tls: RedisTlsConfig
  timeoutMs: number
}

export interface StoredRedisConnection extends Omit<RedisConnectionInput, 'id'> {
  id: string
  createdAt: number
  updatedAt: number
}

export type RedisKeyType = 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream' | 'other'
export type EditableRedisKeyType = Exclude<RedisKeyType, 'stream' | 'other'>

export type RedisKeyValue =
  | string
  | Record<string, string>
  | string[]
  | Array<{ member: string; score: number }>
  | Array<{ id: string; fields: string[] }>

export interface RedisKeyEntry {
  key: string
  type: RedisKeyType
  ttlMs: number
}

export interface RedisKeyDetail extends RedisKeyEntry {
  value: RedisKeyValue
}

export type RedisKeySaveInput = {
  key: string
  ttlMs: number
} & (
  | { type: 'string'; value: string }
  | { type: 'hash'; value: Record<string, string> }
  | { type: 'list' | 'set'; value: string[] }
  | { type: 'zset'; value: Array<{ member: string; score: number }> }
)

export interface RedisKeyPage {
  cursor: string
  keys: RedisKeyEntry[]
}

export interface RedisServerInfo {
  version: string
  mode: string
  connectedClients: number | null
  usedMemory: string | null
  uptimeSeconds: number | null
  databases: Array<{ name: string; keys: number; expires: number }>
}

export type AuthConfig =
  | { kind: 'none' }
  | { kind: 'basic'; username: string; password: string }
  | { kind: 'bearer'; token: string }
  | {
      kind: 'aws'
      accessKeyId: string
      secretAccessKey: string
      sessionToken?: string
      region: string
      /** 'es' for AWS OpenSearch Service, 'aoss' for Serverless collections */
      service?: string
    }

/** Full runtime configuration of a cluster connection. */
export interface ConnectionConfig {
  id: string
  name: string
  url: string
  flavor: ClusterFlavor
  auth: AuthConfig
  tlsVerify: boolean
  timeoutMs: number
}

/** ConnectionConfig as persisted (with audit timestamps). */
export interface StoredConnection extends ConnectionConfig {
  createdAt: number
  updatedAt: number
}

export interface ClusterInfo {
  clusterName: string
  clusterUuid: string
  version: string
  flavor: ClusterFlavor
  distribution: string
}

export interface ClusterHealth {
  status: 'green' | 'yellow' | 'red'
  numberOfNodes: number
  numberOfDataNodes: number
  activeShards: number
  unassignedShards: number
  relocatingShards: number
  initializingShards: number
  delayedUnassignedShards: number
  pendingTasks: number
  timedOut: boolean
}

export interface NodeInfo {
  name: string
  version: string
  ip: string
  roles: string[]
  heapPercent: number | null
  ramPercent: number | null
  diskPercent: number | null
}

export interface IndexInfo {
  name: string
  health: 'green' | 'yellow' | 'red' | null
  status: 'open' | 'close'
  docsCount: number | null
  docsDeleted: number | null
  storeSize: string
  primaryShards: number
  replicas: number
  uuid: string
}

export interface IndexDetail {
  name: string
  settings: Record<string, unknown>
  mappings: Record<string, unknown>
  aliases: Record<string, unknown>
}

export interface SearchHit {
  _index: string
  _id: string
  _score: number | null
  _source: Record<string, unknown>
  /** Highlight fragments per field; values contain <em> markers from the cluster. */
  highlight?: Record<string, string[]>
}

export interface SearchResults {
  total: number | null
  hits: SearchHit[]
  /** Raw response, for panels that want more than hits (aggs, profile, ...) */
  raw: Record<string, unknown>
}

export interface Overview {
  info: ClusterInfo
  health: ClusterHealth
  nodes: NodeInfo[]
}

export interface ShardInfo {
  index: string
  /** Shard number. */
  shard: string
  /** 'p' primary / 'r' replica. */
  type: 'p' | 'r'
  /** STARTED, UNASSIGNED, RELOCATING, INITIALIZING, ... */
  state: string
  /** docs.count */
  docs: number | null
  /** store.size */
  store: string
  ip: string
  /** Node name; null from the cluster becomes 'UNASSIGNED'. */
  node: string
}

export interface SnapshotInfo {
  snapshot: string
  repository: string
  /** SUCCESS, PARTIAL, FAILED, IN_PROGRESS, ... */
  status: string
  /** Comma-separated list of indices. */
  indices: string
  /** Human-readable start time as reported by the cluster. */
  startTime: string
  /** Human-readable end time as reported by the cluster. */
  endTime: string
  /** Raw duration as reported by the cluster (e.g. '10s'). */
  duration: string
  /** start_time_millis, for sorting; null when absent. */
  startMillis: number | null
}

/** Registered snapshot repository (GET /_snapshot). */
export interface SnapshotRepository {
  id: string
  type: string
}

/** Cluster-wide settings: persistent + transient blocks. */
export interface ClusterSettings {
  persistent: Record<string, unknown>
  transient: Record<string, unknown>
}

/** One _bulk response item (index/create/update/delete). */
export interface BulkItemResult {
  /** Action line kind: index | create | update | delete. */
  action: string
  index: string | null
  id: string | null
  status: number | null
  result: string | null
  error: Record<string, unknown> | null
}

/** Aggregated _bulk response. */
export interface BulkResult {
  took: number | null
  errors: boolean
  items: BulkItemResult[]
}

/** Index template (composable or legacy) as listed by GET /_index_template or /_template. */
export interface IndexTemplateInfo {
  name: string
  indexPatterns: string[]
  priority: number | null
  /** Legacy templates only, null otherwise. */
  order: number | null
  /** Component template names the template is composed of. */
  composedOf: string[]
  dataStream: boolean | null
  version: number | null
  /** Raw template body (settings/mappings/aliases) for the editor. */
  body: Record<string, unknown>
}

/** Component template as listed by GET /_component_template. */
export interface ComponentTemplateInfo {
  name: string
  /** Raw component body (template: {settings, mappings, aliases}). */
  body: Record<string, unknown>
}

/** Lifecycle policy: ILM (Elasticsearch) or ISM (OpenSearch). */
export interface IlmPolicyInfo {
  name: string
  /** Ordered phase names defined in the policy (hot, warm, cold, delete / ISM states). */
  phases: string[]
  /** Raw policy body for viewing. */
  body: Record<string, unknown>
}

/** Lifecycle status of a single index (ILM explain / ISM explain). */
export interface IlmIndexStatus {
  index: string
  policy: string | null
  phase: string | null
  action: string | null
  step: string | null
  /** Age of the current phase as reported by the cluster (ILM: phase_time humanized). */
  age: string | null
  /** Failed step name when the index is in ERROR (ILM) / failed (ISM). */
  failedStep: string | null
}

/** One response item from the _msearch multi-search API. */
export interface MsearchItem {
  status: number
  hits: SearchHit[]
  total: number | null
  raw: Record<string, unknown>
}

/** Aggregated _msearch response. */
export interface MsearchResults {
  took: number | null
  responses: MsearchItem[]
}

/** Data stream with its backing indices. */
export interface DataStreamInfo {
  name: string
  timestampField: string | null
  generation: number | null
  status: string | null
  /** Backing indices, oldest first; the last generation is the write index. */
  indices: DataStreamBackingIndex[]
}

/** One backing index of a data stream. */
export interface DataStreamBackingIndex {
  indexName: string
  generation: number | null
  /** true when this backing index accepts writes. */
  writeIndex: boolean
  status: string | null
}

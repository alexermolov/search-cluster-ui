import Redis, { Cluster } from 'ioredis'
import type { RedisKeysScanInput } from '../shared/ipc'
import type {
  RedisConnectionInput,
  RedisKeyDetail,
  RedisKeyEntry,
  RedisKeyPage,
  RedisKeySaveInput,
  RedisKeyType,
  RedisKeyValue,
  RedisServerMode,
  RedisServerInfo,
  StoredRedisConnection,
} from '../shared/types'

type RedisConfig = RedisConnectionInput | StoredRedisConnection
type RedisClient = Redis | Cluster
const REDIS_SCAN_PIPELINE_SIZE = 100
const REDIS_SCAN_CONCURRENCY = 8
const REDIS_COLLECTION_LIMIT = 1000
const REDIS_COMMAND_RESULT_LIMIT = 1000
const REDIS_COMMAND_STRING_LIMIT = 100_000

function parseNodes(value: string): Array<{ host: string; port: number }> {
  return value.split(',').map((raw) => {
    const node = raw.trim()
    const ipv6 = node.match(/^\[([^\]]+)\](?::(\d+))?$/)
    const parts = ipv6 ?? node.match(/^([^:]+)(?::(\d+))?$/)
    if (!parts) throw new Error(`Invalid Redis node address: "${node}"`)
    const host = parts[1]
    const port = Number(parts[2] ?? 6379)
    if (!host || !Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error(`Invalid Redis node address: "${node}"`)
    return { host, port }
  }).filter((node) => Boolean(node.host))
}

function tlsOptions(config: RedisConfig) {
  if (!config.tls.enabled) return undefined
  return {
    rejectUnauthorized: config.tls.rejectUnauthorized,
    ...(config.tls.ca.trim() ? { ca: config.tls.ca } : {}),
    ...(config.tls.cert.trim() ? { cert: config.tls.cert } : {}),
    ...(config.tls.key.trim() ? { key: config.tls.key } : {}),
  }
}

function createRedisClient(config: RedisConfig): RedisClient {
  if (!['standalone', 'cluster', 'sentinel'].includes(config.topology))
    throw new Error('Invalid Redis topology')
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000)
    throw new Error('Timeout must be at least 1000 ms')
  if (
    !config.tls ||
    typeof config.tls.enabled !== 'boolean' ||
    typeof config.tls.rejectUnauthorized !== 'boolean' ||
    typeof config.tls.ca !== 'string' ||
    typeof config.tls.cert !== 'string' ||
    typeof config.tls.key !== 'string'
  )
    throw new Error('Invalid TLS settings')
  if (Boolean(config.tls.cert.trim()) !== Boolean(config.tls.key.trim()))
    throw new Error('Both client certificate and private key are required for mutual TLS')
  if (config.topology === 'standalone') {
    if (!config.host.trim()) throw new Error('Redis host is required')
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
      throw new Error('Port must be between 1 and 65535')
    if (!Number.isInteger(config.db) || config.db < 0)
      throw new Error('Database number must be a non-negative integer')
  } else {
    parseNodes(config.nodes)
    if (config.topology === 'sentinel' && !config.masterName.trim())
      throw new Error('Sentinel master name is required')
  }
  const tls = tlsOptions(config)
  const credentials = {
    ...(config.username ? { username: config.username } : {}),
    ...(config.password ? { password: config.password } : {}),
  }
  const options = {
    connectTimeout: config.timeoutMs,
    commandTimeout: config.timeoutMs,
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    ...(tls ? { tls } : {}),
    ...credentials,
  }
  let client: RedisClient
  switch (config.topology) {
    case 'cluster':
      client = new Cluster(parseNodes(config.nodes), {
        clusterRetryStrategy: (times) => Math.min(times * 100, 1000),
        lazyConnect: true,
        redisOptions: options,
      })
      break
    case 'sentinel':
      client = new Redis({
        ...options,
        sentinels: parseNodes(config.nodes),
        name: config.masterName,
        ...(config.sentinelUsername ? { sentinelUsername: config.sentinelUsername } : {}),
        ...(config.sentinelPassword ? { sentinelPassword: config.sentinelPassword } : {}),
        ...(tls ? { sentinelTLS: tls } : {}),
      })
      break
    default:
      client = new Redis({
        ...options,
        host: config.host,
        port: config.port,
        db: config.db,
      })
  }
  client.on('error', (error) => console.warn(`Redis connection error: ${error.message}`))
  return client
}

class RedisClientCache {
  private readonly entries = new Map<string, { client: RedisClient; hash: string }>()

  get(config: RedisConfig): RedisClient {
    const hash = JSON.stringify(config)
    const id = 'id' in config && config.id ? config.id : `draft:${hash}`
    const existing = this.entries.get(id)
    if (existing?.hash === hash) return existing.client

    existing?.client.disconnect()
    const client = createRedisClient(config)
    this.entries.set(id, { client, hash })
    return client
  }

  drop(id: string): void {
    this.entries.get(id)?.client.disconnect()
    this.entries.delete(id)
  }

  disconnectAll(): void {
    for (const { client } of this.entries.values()) client.disconnect()
    this.entries.clear()
  }
}

const redisClientCache = new RedisClientCache()
const connectionPromises = new WeakMap<RedisClient, Promise<void>>()

function waitForRedisReady(client: RedisClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      client.off('ready', onReady)
      client.off('end', onEnd)
    }
    const onReady = () => {
      cleanup()
      resolve()
    }
    const onEnd = () => {
      cleanup()
      reject(new Error('Redis connection ended before becoming ready'))
    }
    client.once('ready', onReady)
    client.once('end', onEnd)
  })
}

async function ensureConnected(client: RedisClient): Promise<void> {
  if (client.status === 'ready') return
  let connection = connectionPromises.get(client)
  if (!connection) {
    if (client.status === 'end') throw new Error('Redis connection is closed')
    connection = client.status === 'wait' ? client.connect() : waitForRedisReady(client)
    connectionPromises.set(client, connection)
  }
  try {
    await connection
  } finally {
    if (connectionPromises.get(client) === connection) connectionPromises.delete(client)
  }
}

export function dropRedisClient(id: string): void {
  redisClientCache.drop(id)
}

export function disconnectRedisClients(): void {
  redisClientCache.disconnectAll()
}

async function withRedis<T>(config: RedisConfig, operation: (client: RedisClient) => Promise<T>): Promise<T> {
  const client = redisClientCache.get(config)
  await ensureConnected(client)
  return operation(client)
}

function parseInfo(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf(':')
    if (separator > 0) result[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return result
}

function toNumber(value: string | undefined): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function normalizeMode(value: string | undefined): RedisServerMode {
  if (value === 'cluster' || value === 'sentinel') return value
  return 'standalone'
}

function toServerInfo(
  server: string,
  clients: string,
  memory: string,
  keyspace: string,
  stats: string,
  replication: string,
  cpu: string,
): RedisServerInfo {
  const serverInfo = parseInfo(server)
  const clientInfo = parseInfo(clients)
  const memoryInfo = parseInfo(memory)
  const statsInfo = parseInfo(stats)
  const replInfo = parseInfo(replication)
  const cpuInfo = parseInfo(cpu)

  const databases = Object.entries(parseInfo(keyspace))
    .filter(([name]) => /^db\d+$/.test(name))
    .map(([name, value]) => {
      const fields = Object.fromEntries(value.split(',').map((field) => field.split('=')))
      return {
        name,
        keys: Number(fields.keys) || 0,
        expires: Number(fields.expires) || 0,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const totalKeys = databases.reduce((sum, db) => sum + db.keys, 0)

  return {
    version: serverInfo.redis_version ?? 'unknown',
    mode: normalizeMode(serverInfo.redis_mode),
    role: (replInfo.role as RedisServerInfo['role']) ?? null,
    os: serverInfo.os ?? null,
    archBits: toNumber(serverInfo.arch_bits),
    tcpPort: toNumber(serverInfo.tcp_port),
    connectedClients: toNumber(clientInfo.connected_clients),
    blockedClients: toNumber(clientInfo.blocked_clients),
    usedMemory: memoryInfo.used_memory_human ?? null,
    usedMemoryRss: memoryInfo.used_memory_rss_human ?? null,
    maxmemory: memoryInfo.maxmemory_human ?? null,
    maxmemoryPolicy: memoryInfo.maxmemory_policy ?? null,
    uptimeSeconds: toNumber(serverInfo.uptime_in_seconds),
    instantaneousOpsPerSec: toNumber(statsInfo.instantaneous_ops_per_sec),
    totalCommandsProcessed: toNumber(statsInfo.total_commands_processed),
    keyspaceHits: toNumber(statsInfo.keyspace_hits),
    keyspaceMisses: toNumber(statsInfo.keyspace_misses),
    expiredKeys: toNumber(statsInfo.expired_keys),
    evictedKeys: toNumber(statsInfo.evicted_keys),
    connectedSlaves: toNumber(replInfo.connected_slaves),
    masterLinkStatus: replInfo.master_link_status === 'up' ? 'up' : replInfo.master_link_status === 'down' ? 'down' : null,
    usedCpuSys: toNumber(cpuInfo.used_cpu_sys),
    usedCpuUser: toNumber(cpuInfo.used_cpu_user),
    databases,
    totalKeys,
  }
}

async function serverInfo(client: RedisClient): Promise<RedisServerInfo> {
  const [server, clients, memory, keyspace, stats, replication, cpu] = await Promise.all([
    client.info('server'),
    client.info('clients'),
    client.info('memory'),
    client.info('keyspace'),
    client.info('stats'),
    client.info('replication'),
    client.info('cpu'),
  ])
  return toServerInfo(server, clients, memory, keyspace, stats, replication, cpu)
}

export async function testRedisConnection(config: RedisConfig): Promise<RedisServerInfo> {
  const client = createRedisClient(config)
  try {
    await ensureConnected(client)
    await client.ping()
    return serverInfo(client)
  } finally {
    client.disconnect()
  }
}

export async function fetchRedisServerInfo(config: RedisConfig): Promise<RedisServerInfo> {
  return withRedis(config, serverInfo)
}

function redisKeyType(value: string): RedisKeyType {
  if (value === 'string' || value === 'hash' || value === 'list' || value === 'set' || value === 'zset')
    return value
  if (value === 'stream') return value
  return 'other'
}

async function scanNode(
  node: Redis,
  cursor: string,
  pattern: string,
  count: number,
): Promise<[string, string[]]> {
  return node.scan(cursor, 'MATCH', pattern, 'COUNT', count)
}

export async function scanRedisKeys(
  config: RedisConfig,
  input: RedisKeysScanInput,
): Promise<RedisKeyPage> {
  const { pattern, count } = input
  if (!pattern.trim()) throw new Error('A key pattern is required')
  if (!Number.isInteger(count) || count < 1 || count > 1000)
    throw new Error('Scan count must be between 1 and 1000')

  return withRedis(config, async (client) => {
    let keys: string[] = []
    let nextCursor: string
    if (client instanceof Cluster) {
      const nodes = client.nodes('master')
      if (nodes.length === 0) throw new Error('Redis Cluster has no reachable master nodes')
      let cursors = nodes.map(() => '0')
      if (input.cursor) {
        try {
          const parsed = JSON.parse(input.cursor) as unknown
          if (!Array.isArray(parsed) || parsed.length !== nodes.length || parsed.some((v) => typeof v !== 'string'))
            throw new Error('Invalid cluster scan cursor')
          cursors = parsed
        } catch {
          throw new Error('Invalid cluster scan cursor')
        }
      }
      const results: Array<[string, string[]]> = new Array(nodes.length)
      for (let offset = 0; offset < nodes.length; offset += REDIS_SCAN_CONCURRENCY) {
        await Promise.all(
          nodes.slice(offset, offset + REDIS_SCAN_CONCURRENCY).map(async (node, batchIndex) => {
            const index = offset + batchIndex
            results[index] = await scanNode(node, cursors[index], pattern, count)
          }),
        )
      }
      keys = results.flatMap((result) => result[1])
      const updatedCursors = results.map((result) => result[0])
      nextCursor = updatedCursors.every((cursor) => cursor === '0') ? '' : JSON.stringify(updatedCursors)
    } else {
      const [cursor, found] = await scanNode(client, input.cursor || '0', pattern, count)
      keys = found
      nextCursor = cursor === '0' ? '' : cursor
    }

    const entries: RedisKeyEntry[] = []
    for (let offset = 0; offset < keys.length; offset += REDIS_SCAN_PIPELINE_SIZE) {
      const batch = keys.slice(offset, offset + REDIS_SCAN_PIPELINE_SIZE)
      const pipeline = client.pipeline()
      for (const key of batch) pipeline.type(key).pttl(key)
      const results = await pipeline.exec()
      if (!results) throw new Error('Redis did not execute the key metadata pipeline')
      for (let index = 0; index < batch.length; index += 1) {
        const [typeError, type] = results[index * 2]
        const [ttlError, ttlMs] = results[index * 2 + 1]
        if (typeError) throw typeError
        if (ttlError) throw ttlError
        entries.push({
          key: batch[index],
          type: redisKeyType(String(type)),
          ttlMs: Number(ttlMs),
        })
      }
    }
    return {
      cursor: nextCursor,
      keys: entries.filter((entry) => entry.type !== 'other').sort((a, b) => a.key.localeCompare(b.key)),
    }
  })
}

interface ReadKeyValueResult {
  value: RedisKeyValue
  truncated: boolean
}

async function readScannedCollection(
  client: RedisClient,
  key: string,
  type: 'hash' | 'set',
): Promise<ReadKeyValueResult> {
  let cursor = '0'
  let truncated = false
  const hashEntries: Array<[string, string]> = []
  const setValue: string[] = []
  let hashCount = 0

  do {
    const remaining = REDIS_COLLECTION_LIMIT - (type === 'hash' ? hashCount : setValue.length)
    const [nextCursor, values] = type === 'hash'
      ? await client.hscan(key, cursor, 'COUNT', Math.min(100, remaining + 1))
      : await client.sscan(key, cursor, 'COUNT', Math.min(100, remaining + 1))
    cursor = nextCursor
    if (type === 'hash') {
      for (let index = 0; index + 1 < values.length; index += 2) {
        if (hashCount >= REDIS_COLLECTION_LIMIT) {
          truncated = true
          break
        }
        hashEntries.push([values[index], values[index + 1]])
        hashCount += 1
      }
    } else {
      const available = REDIS_COLLECTION_LIMIT - setValue.length
      setValue.push(...values.slice(0, available))
      if (values.length > available) truncated = true
    }
    if (cursor !== '0' && (type === 'hash' ? hashCount : setValue.length) >= REDIS_COLLECTION_LIMIT)
      truncated = true
  } while (cursor !== '0' && !truncated)

  return {
    value: type === 'hash' ? Object.fromEntries(hashEntries) : setValue,
    truncated,
  }
}

async function readKeyValue(client: RedisClient, key: string, type: RedisKeyType): Promise<ReadKeyValueResult> {
  switch (type) {
    case 'string':
      return { value: (await client.get(key)) ?? '', truncated: false }
    case 'hash':
    case 'set':
      return readScannedCollection(client, key, type)
    case 'list': {
      const values = await client.lrange(key, 0, REDIS_COLLECTION_LIMIT)
      return { value: values.slice(0, REDIS_COLLECTION_LIMIT), truncated: values.length > REDIS_COLLECTION_LIMIT }
    }
    case 'zset': {
      const values = await client.zrange(key, '0', String(REDIS_COLLECTION_LIMIT), 'WITHSCORES')
      const limitedValues = values.slice(0, REDIS_COLLECTION_LIMIT * 2)
      return {
        value: limitedValues.reduce<Array<{ member: string; score: number }>>((result, value, index) => {
          if (index % 2 === 0) result.push({ member: value, score: Number(limitedValues[index + 1]) })
          return result
        }, []),
        truncated: values.length > REDIS_COLLECTION_LIMIT * 2,
      }
    }
    case 'stream': {
      const values = await client.xrange(key, '-', '+', 'COUNT', 101)
      return {
        value: values.slice(0, 100).map(([id, fields]) => ({ id, fields })),
        truncated: values.length > 100,
      }
    }
    default:
      throw new Error(`Editing Redis keys of type "${type}" is not supported`)
  }
}

export async function getRedisKey(config: RedisConfig, key: string): Promise<RedisKeyDetail> {
  if (!key.trim()) throw new Error('A Redis key is required')
  return withRedis(config, async (client) => {
    const type = redisKeyType(await client.type(key))
    if (type === 'other') throw new Error(`Key "${key}" does not exist or has an unsupported type`)
    const [ttlMs, result] = await Promise.all([
      client.pttl(key),
      readKeyValue(client, key, type),
    ])
    return { key, type, ttlMs, ...result }
  })
}

function validateKeyValue(input: RedisKeySaveInput): void {
  switch (input.type) {
    case 'string':
      if (typeof input.value !== 'string') throw new Error('String values must be text')
      return
    case 'hash':
      if (
        typeof input.value !== 'object' ||
        input.value === null ||
        Array.isArray(input.value) ||
        Object.values(input.value).some((value) => typeof value !== 'string')
      )
        throw new Error('Hash values must be a JSON object of field/value pairs')
      if (Object.keys(input.value).length === 0) throw new Error('Redis does not store empty collections')
      return
    case 'list':
    case 'set':
      if (!Array.isArray(input.value) || input.value.some((value) => typeof value !== 'string'))
        throw new Error(`${input.type} values must be an array of strings`)
      if (input.value.length === 0) throw new Error('Redis does not store empty collections')
      return
    case 'zset':
      if (
        !Array.isArray(input.value) ||
        input.value.some(
          (item) =>
            typeof item !== 'object' ||
            item === null ||
            typeof item.member !== 'string' ||
            !Number.isFinite(item.score),
        )
      )
        throw new Error('Sorted set values must be an array of {member, score} objects')
      if (input.value.length === 0) throw new Error('Redis does not store empty collections')
      return
    default:
      throw new Error('This Redis key type cannot be edited')
  }
}

async function writeKeyValue(client: RedisClient, input: RedisKeySaveInput): Promise<void> {
  validateKeyValue(input)
  if (!Number.isInteger(input.ttlMs) || input.ttlMs < -1)
    throw new Error('TTL must be -1 (no expiration) or a non-negative number of milliseconds')
  const transaction = client.multi()
  transaction.del(input.key)
  switch (input.type) {
    case 'string':
      transaction.set(input.key, input.value)
      break
    case 'hash': {
      const entries = Object.entries(input.value).flat()
      transaction.hset(input.key, ...entries)
      break
    }
    case 'list':
      transaction.rpush(input.key, ...input.value)
      break
    case 'set':
      transaction.sadd(input.key, ...input.value)
      break
    case 'zset': {
      const entries = input.value.flatMap(({ member, score }) => [
        String(score),
        member,
      ])
      transaction.zadd(input.key, ...entries)
      break
    }
    default:
      throw new Error('This Redis key type cannot be edited')
  }
  if (input.ttlMs >= 0) transaction.pexpire(input.key, input.ttlMs)
  const results = await transaction.exec()
  if (!results) throw new Error('Redis did not execute the key update transaction')
  const failed = results.find(([reason]) => reason)?.[0]
  if (failed) throw failed
}

export async function saveRedisKey(config: RedisConfig, input: RedisKeySaveInput): Promise<void> {
  if (!input.key.trim()) throw new Error('A Redis key is required')
  return withRedis(config, (client) => writeKeyValue(client, input))
}

export async function deleteRedisKey(config: RedisConfig, key: string): Promise<void> {
  if (!key.trim()) throw new Error('A Redis key is required')
  return withRedis(config, async (client) => {
    const deleted = await client.del(key)
    if (!deleted) throw new Error(`Key "${key}" does not exist`)
  })
}

function parseCommand(command: string): string[] {
  if (command.length > 8192) throw new Error('Command is too long')
  const args: string[] = []
  let token = ''
  let quote: '"' | "'" | null = null
  let escaped = false
  let started = false
  for (const char of command.trim()) {
    if (escaped) {
      token += char
      escaped = false
      started = true
    } else if (char === '\\') {
      escaped = true
      started = true
    } else if (quote) {
      if (char === quote) quote = null
      else token += char
      started = true
    } else if (char === '"' || char === "'") {
      quote = char
      started = true
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(token)
        token = ''
        started = false
      }
    } else {
      token += char
      started = true
    }
  }
  if (escaped || quote) throw new Error('Unclosed quote or escape in command')
  if (started) args.push(token)
  if (args.length === 0) throw new Error('Enter a Redis command')
  return args
}

function normalizeCommandResult(value: unknown, budget: { remaining: number }): unknown {
  if (budget.remaining <= 0) return '[truncated]'
  budget.remaining -= 1
  if (Buffer.isBuffer(value)) value = value.toString('utf8')
  if (typeof value === 'string') {
    return value.length > REDIS_COMMAND_STRING_LIMIT
      ? `${value.slice(0, REDIS_COMMAND_STRING_LIMIT)}\n[truncated]`
      : value
  }
  if (Array.isArray(value)) {
    const values = value.slice(0, budget.remaining).map((item) => normalizeCommandResult(item, budget))
    if (values.length < value.length) values.push('[truncated]')
    return values
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value)
    const normalized = Object.fromEntries(
      entries.slice(0, budget.remaining).map(([key, item]) => [key, normalizeCommandResult(item, budget)]),
    )
    if (entries.length > Object.keys(normalized).length) normalized._truncated = true
    return normalized
  }
  return value
}

export async function runRedisCommand(config: RedisConfig, command: string): Promise<unknown> {
  const args = parseCommand(command)
  return withRedis(config, async (client) =>
    normalizeCommandResult(await client.call(args[0].toUpperCase(), ...args.slice(1)), {
      remaining: REDIS_COMMAND_RESULT_LIMIT,
    }),
  )
}

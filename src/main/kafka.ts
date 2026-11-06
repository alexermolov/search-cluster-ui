import { createHash } from 'node:crypto'
import { Kafka, logLevel, type Consumer, type EachMessagePayload } from 'kafkajs'
import type {
  KafkaMessageProduceInput,
  KafkaMessagesInput,
  KafkaSearchInput,
  KafkaTopicCreateInput,
} from '../shared/ipc'
import type {
  KafkaAuthConfig,
  KafkaConnectionInput,
  KafkaConsumerGroupInfo,
  KafkaConsumerGroupMember,
  KafkaMessage,
  KafkaSearchProgress,
  KafkaSearchResult,
  KafkaPartitionInfo,
  KafkaTopicInfo,
  StoredKafkaConnection,
} from '../shared/types'

export type KafkaConnection = KafkaConnectionInput | StoredKafkaConnection
const KAFKA_OFFSET_CONCURRENCY = 8
const KAFKA_SEARCH_PROGRESS_INTERVAL_MS = 500
const KAFKA_SEARCH_IDLE_TIMEOUT_MS = 3_000
const KAFKA_SEARCH_BATCH_YIELD_SIZE = 1_000

function hashString(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8)
}

function hashConfig(config: KafkaConnection): string {
  return JSON.stringify({
    brokers: config.brokers,
    auth: config.auth,
    tls: config.tls,
    timeoutMs: config.timeoutMs,
  })
}

function saslOptions(auth: KafkaAuthConfig) {
  const credentials = { username: auth.username, password: auth.password }
  switch (auth.mechanism) {
    case 'plain':
      return { mechanism: 'plain' as const, ...credentials }
    case 'scram-sha-256':
      return { mechanism: 'scram-sha-256' as const, ...credentials }
    case 'scram-sha-512':
      return { mechanism: 'scram-sha-512' as const, ...credentials }
  }
}

function buildKafka(config: KafkaConnection): Kafka {
  const brokers = config.brokers
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean)
  if (brokers.length === 0) throw new Error('At least one Kafka broker is required')
  if (config.auth && (!config.auth.username.trim() || !config.auth.password))
    throw new Error('SASL username and password are required')
  if (Boolean(config.tls.cert.trim()) !== Boolean(config.tls.key.trim()))
    throw new Error('Both client certificate and private key are required for mutual TLS')

  return new Kafka({
    clientId: 'search-cluster-ui',
    brokers,
    connectionTimeout: config.timeoutMs,
    requestTimeout: config.timeoutMs,
    logLevel: logLevel.ERROR,
    ...(config.tls.enabled
      ? {
          ssl: {
            rejectUnauthorized: config.tls.rejectUnauthorized,
            ...(config.tls.ca.trim() ? { ca: [config.tls.ca] } : {}),
            ...(config.tls.cert.trim() ? { cert: config.tls.cert } : {}),
            ...(config.tls.key.trim() ? { key: config.tls.key } : {}),
            ...(config.tls.passphrase ? { passphrase: config.tls.passphrase } : {}),
          },
        }
      : {}),
    ...(config.auth
      ? {
          sasl: saslOptions(config.auth),
        }
      : {}),
  })
}

class CachedClient {
  kafka: Kafka
  adminConnected = false
  producerConnected = false

  constructor(kafka: Kafka) {
    this.kafka = kafka
  }

  async admin() {
    const admin = this.kafka.admin()
    if (!this.adminConnected) {
      await admin.connect()
      this.adminConnected = true
    }
    return admin
  }

  async producer() {
    const producer = this.kafka.producer()
    if (!this.producerConnected) {
      await producer.connect()
      this.producerConnected = true
    }
    return producer
  }

  async disconnect() {
    const admin = this.kafka.admin()
    const producer = this.kafka.producer()
    if (this.adminConnected) {
      try {
        await admin.disconnect()
      } catch {
        /* ignore */
      }
      this.adminConnected = false
    }
    if (this.producerConnected) {
      try {
        await producer.disconnect()
      } catch {
        /* ignore */
      }
      this.producerConnected = false
    }
  }
}

export class KafkaClientCache {
  private entries = new Map<string, { client: CachedClient; hash: string }>()

  get(config: KafkaConnection): CachedClient {
    const id = ('id' in config && config.id) ? config.id : 'draft'
    const hash = hashConfig(config)
    const existing = this.entries.get(id)
    if (existing && existing.hash === hash) return existing.client

    existing?.client.disconnect().catch(() => undefined)
    const client = new CachedClient(buildKafka(config))
    this.entries.set(id, { client, hash })
    return client
  }

  drop(id: string): void {
    const existing = this.entries.get(id)
    if (existing) {
      existing.client.disconnect().catch(() => undefined)
      this.entries.delete(id)
    }
  }

  async disconnectAll(): Promise<void> {
    await Promise.all(
      Array.from(this.entries.values()).map((e) => e.client.disconnect().catch(() => undefined)),
    )
    this.entries.clear()
  }
}

export async function testKafkaConnection(
  config: KafkaConnection,
): Promise<{ brokers: number; clusterId: string }> {
  const admin = buildKafka(config).admin()
  try {
    await admin.connect()
    const cluster = await admin.describeCluster()
    return { brokers: cluster.brokers.length, clusterId: cluster.clusterId }
  } finally {
    try {
      await admin.disconnect()
    } catch {
      /* ignore */
    }
  }
}

export async function listKafkaTopics(
  cache: KafkaClientCache,
  config: KafkaConnection,
): Promise<KafkaTopicInfo[]> {
  const client = cache.get(config)
  const admin = await client.admin()
  const metadata = await admin.fetchTopicMetadata()
  return metadata.topics
    .map((topic) => ({ name: topic.name, partitions: topic.partitions.length }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function createKafkaTopic(
  cache: KafkaClientCache,
  config: KafkaConnection,
  { topic, numPartitions, replicationFactor }: KafkaTopicCreateInput,
): Promise<boolean> {
  if (!topic.trim()) throw new Error('A Kafka topic name is required')
  if (!Number.isInteger(numPartitions) || numPartitions < 1)
    throw new Error('Partition count must be a positive integer')
  if (!Number.isInteger(replicationFactor) || replicationFactor < 1)
    throw new Error('Replication factor must be a positive integer')

  const client = cache.get(config)
  const admin = await client.admin()
  return await admin.createTopics({
    topics: [{ topic: topic.trim(), numPartitions, replicationFactor }],
    waitForLeaders: true,
  })
}

export async function deleteKafkaTopic(
  cache: KafkaClientCache,
  config: KafkaConnection,
  topic: string,
): Promise<void> {
  if (!topic.trim()) throw new Error('A Kafka topic name is required')
  const client = cache.get(config)
  const admin = await client.admin()
  await admin.deleteTopics({ topics: [topic.trim()] })
}

export async function fetchKafkaTopicPartitions(
  cache: KafkaClientCache,
  config: KafkaConnection,
  topic: string,
): Promise<KafkaPartitionInfo[]> {
  if (!topic.trim()) throw new Error('A Kafka topic name is required')
  const client = cache.get(config)
  const admin = await client.admin()
  const [metadata, offsets] = await Promise.all([
    admin.fetchTopicMetadata({ topics: [topic.trim()] }),
    admin.fetchTopicOffsets(topic.trim()),
  ])
  const topicMeta = metadata.topics.find((t) => t.name === topic.trim())
  if (!topicMeta) throw new Error(`Topic "${topic}" not found`)

  const offsetMap = new Map(offsets.map((o) => [o.partition, o]))
  return topicMeta.partitions
    .map((p): KafkaPartitionInfo => {
      const off = offsetMap.get(p.partitionId)
      return {
        partition: p.partitionId,
        leader: p.leader ?? null,
        replicas: p.replicas,
        isr: p.isr,
        lowOffset: off?.low ?? '0',
        highOffset: off?.high ?? '0',
      }
    })
    .sort((a, b) => a.partition - b.partition)
}

function parseMemberAssignment(buffer: Buffer): Record<string, number[]> {
  try {
    let offset = 0
    const readInt16 = () => {
      const val = buffer.readInt16BE(offset)
      offset += 2
      return val
    }
    const readInt32 = () => {
      const val = buffer.readInt32BE(offset)
      offset += 4
      return val
    }
    const readString = () => {
      const len = readInt16()
      if (len < 0) return ''
      const str = buffer.toString('utf8', offset, offset + len)
      offset += len
      return str
    }
    // Version
    readInt16()
    const topicCount = readInt32()
    const topics: string[] = []
    for (let i = 0; i < topicCount; i++) {
      topics.push(readString())
    }
    const partitionCount = readInt32()
    const partitions: number[] = []
    for (let i = 0; i < partitionCount; i++) {
      partitions.push(readInt32())
    }
    // Assign all partitions to all topics (simplified; in reality assignment is per-topic)
    const result: Record<string, number[]> = {}
    for (const topic of topics) {
      result[topic] = [...partitions]
    }
    return result
  } catch {
    return {}
  }
}

export async function fetchKafkaConsumerGroups(
  cache: KafkaClientCache,
  config: KafkaConnection,
  topic?: string,
): Promise<KafkaConsumerGroupInfo[]> {
  const client = cache.get(config)
  const admin = await client.admin()
  const groupsResponse = await admin.listGroups()
  const groupIds = groupsResponse.groups.map((g) => g.groupId)
  if (groupIds.length === 0) return []

  const { groups: descriptions } = await admin.describeGroups(groupIds)

  const relevantGroupIds = topic
    ? descriptions
        .filter((desc) =>
          desc.members.some((member) => topic in parseMemberAssignment(member.memberAssignment)),
        )
        .map((desc) => desc.groupId)
    : groupIds
  if (relevantGroupIds.length === 0) return []

  // Keep the number of concurrent broker requests bounded on large clusters.
  const offsetMap = new Map<string, Map<string, Map<number, string>>>()
  for (let offset = 0; offset < relevantGroupIds.length; offset += KAFKA_OFFSET_CONCURRENCY) {
    await Promise.all(
      relevantGroupIds.slice(offset, offset + KAFKA_OFFSET_CONCURRENCY).map(async (groupId) => {
        try {
          const offsets = await admin.fetchOffsets({ groupId, resolveOffsets: true })
          const topicMap = new Map<string, Map<number, string>>()
          for (const topicOffset of offsets) {
            const partitionMap = new Map<number, string>()
            for (const po of topicOffset.partitions) {
              partitionMap.set(po.partition, po.offset)
            }
            topicMap.set(topicOffset.topic, partitionMap)
          }
          offsetMap.set(groupId, topicMap)
        } catch {
          // Group may not have offsets yet
        }
      }),
    )
  }

  // Fetch high watermarks for relevant topics in parallel
  const allTopics = new Set<string>()
  for (const desc of descriptions) {
    if (topic && !relevantGroupIds.includes(desc.groupId)) continue
    for (const member of desc.members) {
      const assignments = parseMemberAssignment(member.memberAssignment)
      for (const assignedTopic of Object.keys(assignments)) {
        allTopics.add(assignedTopic)
      }
    }
  }
  for (const topicMap of offsetMap.values()) {
    for (const offsetTopic of topicMap.keys()) {
      allTopics.add(offsetTopic)
    }
  }

  const topicsToFetch = topic ? [topic] : Array.from(allTopics)
  const topicHighOffsets = new Map<string, Map<number, string>>()
  for (let offset = 0; offset < topicsToFetch.length; offset += KAFKA_OFFSET_CONCURRENCY) {
    await Promise.all(
      topicsToFetch.slice(offset, offset + KAFKA_OFFSET_CONCURRENCY).map(async (topicToFetch) => {
        try {
          const topicOffsets = await admin.fetchTopicOffsets(topicToFetch)
          const map = new Map<number, string>()
          for (const o of topicOffsets) {
            map.set(o.partition, o.high)
          }
          topicHighOffsets.set(topicToFetch, map)
        } catch {
          // Topic may not exist
        }
      }),
    )
  }

  return descriptions
    .filter((desc) => !topic || relevantGroupIds.includes(desc.groupId))
    .map((desc): KafkaConsumerGroupInfo => {
      const lag: Record<string, Record<string, number>> = {}
      const groupOffsets = offsetMap.get(desc.groupId)

      if (groupOffsets) {
        for (const [offsetTopic, partitionMap] of groupOffsets) {
          if (topic && offsetTopic !== topic) continue
          const highMap = topicHighOffsets.get(offsetTopic)
          if (!highMap) continue
          const topicLag: Record<string, number> = {}
          for (const [partition, currentOffset] of partitionMap) {
            const high = highMap.get(partition)
            if (high !== undefined) {
              const lagValue = Number(high) - Number(currentOffset)
              topicLag[String(partition)] = lagValue >= 0 ? lagValue : 0
            }
          }
          if (Object.keys(topicLag).length > 0) {
            lag[offsetTopic] = topicLag
          }
        }
      }

      return {
        groupId: desc.groupId,
        protocol: desc.protocol,
        state: desc.state,
        members: desc.members.map(
          (m): KafkaConsumerGroupMember => ({
            clientId: m.clientId,
            clientHost: m.clientHost,
            memberId: m.memberId,
            assignments: Object.entries(parseMemberAssignment(m.memberAssignment)).map(
              ([topic, partitions]) => ({ topic, partitions }),
            ),
          }),
        ),
        lag,
      }
    })
}

export async function produceKafkaMessage(
  cache: KafkaClientCache,
  config: KafkaConnection,
  { topic, key, value }: KafkaMessageProduceInput,
): Promise<void> {
  if (!topic.trim()) throw new Error('A Kafka topic is required')
  if (!value) throw new Error('A message value is required')

  const client = cache.get(config)
  const producer = await client.producer()
  await producer.send({
    topic: topic.trim(),
    messages: [{ ...(key !== null ? { key } : {}), value }],
  })
}

function decode(buffer: Buffer | null): string | null {
  if (!buffer) return null
  const text = buffer.toString('utf8')
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function toKafkaMessage({
  topic,
  partition,
  message,
}: Pick<EachMessagePayload, 'topic' | 'partition' | 'message'>): KafkaMessage {
  const headers: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(message.headers ?? {})) {
    headers[key] = Array.isArray(value)
      ? value.map((item) => item.toString('utf8')).join(', ')
      : value?.toString('utf8') ?? null
  }
  return {
    topic,
    partition,
    offset: message.offset,
    timestamp: message.timestamp || null,
    key: decode(message.key),
    value: decode(message.value),
    headers,
  }
}

function compareKafkaMessages(
  a: Pick<KafkaMessage, 'timestamp' | 'offset' | 'partition'>,
  b: Pick<KafkaMessage, 'timestamp' | 'offset' | 'partition'>,
): number {
  const timeDiff = Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0)
  if (timeDiff) return timeDiff
  const offsetA = BigInt(a.offset)
  const offsetB = BigInt(b.offset)
  return offsetA > offsetB ? -1 : offsetA < offsetB ? 1 : a.partition - b.partition
}

function kafkaMessageMatches(
  topic: string,
  partition: number,
  message: EachMessagePayload['message'],
  query: string,
): boolean {
  const matches = (value: string | Buffer | null | undefined) => {
    if (value == null) return false
    const text = typeof value === 'string' ? value : value.toString('utf8')
    return text.toLowerCase().includes(query)
  }

  if (topic.toLowerCase().includes(query)) return true
  if (
    matches(message.key) ||
    matches(message.value) ||
    message.timestamp.toLowerCase().includes(query) ||
    message.offset.includes(query) ||
    String(partition).includes(query)
  ) {
    return true
  }
  return Object.entries(message.headers ?? {}).some(
    ([key, value]) =>
      key.toLowerCase().includes(query) ||
      (Array.isArray(value) ? value.some(matches) : matches(value)),
  )
}

export async function fetchKafkaMessages(
  cache: KafkaClientCache,
  config: KafkaConnection,
  { topic, limit }: KafkaMessagesInput,
  signal?: AbortSignal,
): Promise<KafkaMessage[]> {
  if (!topic.trim()) throw new Error('A Kafka topic is required')
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Message limit must be between 1 and 100')

  const client = cache.get(config)
  const admin = await client.admin()
  const connectionId = ('id' in config && config.id) ? config.id : 'draft'
  // Stable groupId per connection+topic so we don't leak consumer groups on every refresh
  const groupId = `search-cluster-ui-${connectionId.slice(0, 8)}-${hashString(topic)}`
  let consumer: Consumer | undefined

  try {
    const offsets = await admin.fetchTopicOffsets(topic)
    if (!offsets.length) throw new Error(`Topic "${topic}" has no partitions`)

    const perPartitionLimit = Math.ceil(limit / offsets.length)
    const endOffsets = new Map(offsets.map((item) => [item.partition, BigInt(item.high)]))
    const starts = new Map(
      offsets.map((item) => {
        const low = BigInt(item.low)
        const high = BigInt(item.high)
        const start = high > BigInt(perPartitionLimit) ? high - BigInt(perPartitionLimit) : 0n
        return [item.partition, start > low ? start : low]
      }),
    )
    const messages: KafkaMessage[] = []
    const finished = new Set<number>()
    consumer = client.kafka.consumer({ groupId })
    await consumer.connect()
    await consumer.subscribe({ topic, fromBeginning: true })
    let completed = false
    let resolveDone!: () => void
    let rejectDone!: (reason: Error) => void
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve
      rejectDone = reject
    })
    let timer: ReturnType<typeof setTimeout>
    let idleTimer: ReturnType<typeof setTimeout> | null = null

    const finish = () => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      if (idleTimer) clearTimeout(idleTimer)
      void consumer?.stop().then(resolveDone, rejectDone)
    }

    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(finish, 1500)
    }

    timer = setTimeout(
      () => {
        if (completed) return
        completed = true
        if (idleTimer) clearTimeout(idleTimer)
        rejectDone(new Error(`Timed out while reading messages from "${topic}"`))
      },
      Math.max(30_000, config.timeoutMs),
    )

    const onAbort = () => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      if (idleTimer) clearTimeout(idleTimer)
      rejectDone(new Error('Request cancelled'))
    }
    signal?.addEventListener('abort', onAbort)

    consumer.on(consumer.events.GROUP_JOIN, ({ payload }) => {
      const assigned = payload.memberAssignment[topic] ?? []
      resetIdleTimer()
      for (const partition of assigned) {
        const start = starts.get(partition)
        if (start !== undefined) {
          if (start >= (endOffsets.get(partition) ?? 0n)) finished.add(partition)
          else consumer?.seek({ topic, partition, offset: start.toString() })
        } else finished.add(partition)
      }
      if (assigned.length === 0 || finished.size === offsets.length) finish()
    })

    void consumer
      .run({
        eachMessage: async (payload) => {
          const message = toKafkaMessage(payload)
          messages.push(message)
          resetIdleTimer()
          const end = endOffsets.get(payload.partition)
          if (end !== undefined && BigInt(payload.message.offset) + 1n >= end)
            finished.add(payload.partition)
          if (messages.length >= limit || finished.size === offsets.length) finish()
        },
      })
      .catch((reason: unknown) => {
        if (completed) return
        completed = true
        clearTimeout(timer)
        if (idleTimer) clearTimeout(idleTimer)
        rejectDone(reason instanceof Error ? reason : new Error(String(reason)))
      })

    try {
      await done
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }

    return messages.sort(compareKafkaMessages)
  } finally {
    try {
      if (consumer) {
        await consumer.stop().catch(() => undefined)
        await consumer.disconnect().catch(() => undefined)
      }
    } catch {
      /* ignore */
    }
  }
}

export async function searchKafkaMessages(
    cache: KafkaClientCache,
    config: KafkaConnection,
    { topic, query, limit }: KafkaSearchInput,
    signal: AbortSignal | undefined,
    onProgress: (progress: KafkaSearchProgress) => void,
  ): Promise<KafkaSearchResult> {
    const normalizedTopic = topic.trim()
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedTopic) throw new Error('A Kafka topic is required')
    if (!normalizedQuery) throw new Error('A search query is required')
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new Error('Search result limit must be between 1 and 100')
    if (signal?.aborted) throw new Error('Request cancelled')

    const client = cache.get(config)
    const admin = await client.admin()
    const connectionId = ('id' in config && config.id) ? config.id : 'draft'
    const groupId = `search-cluster-ui-${connectionId.slice(0, 8)}-${hashString(normalizedTopic)}-search`
    let consumer: Consumer | undefined

    try {
      const offsets = await admin.fetchTopicOffsets(normalizedTopic)
      if (!offsets.length) throw new Error(`Topic "${normalizedTopic}" has no partitions`)

      const starts = new Map(offsets.map((item) => [item.partition, BigInt(item.low)]))
      const ends = new Map(offsets.map((item) => [item.partition, BigInt(item.high)]))
      const finished = new Set<number>()
      const messages: KafkaMessage[] = []
      let scanned = 0
      let completed = false
      let resolveDone!: () => void
      let rejectDone!: (reason: Error) => void
      let idleTimer: ReturnType<typeof setTimeout> | null = null
      let progressTimer: ReturnType<typeof setInterval> | null = null
      let lastReportedScanned = -1

      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve
        rejectDone = reject
      })
      consumer = client.kafka.consumer({ groupId })

      const flushProgress = () => {
        if (scanned === lastReportedScanned) return
        lastReportedScanned = scanned
        onProgress({ messages: messages.slice(), scanned })
      }
      const clearTimers = () => {
        if (idleTimer) clearTimeout(idleTimer)
        if (progressTimer) clearInterval(progressTimer)
      }
      const finish = (error?: Error) => {
        if (completed) return
        completed = true
        clearTimers()
        void consumer?.stop().then(
          () => (error ? rejectDone(error) : resolveDone()),
          (reason: unknown) =>
            rejectDone(reason instanceof Error ? reason : new Error(String(reason))),
        )
      }
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer)
        idleTimer = setTimeout(finish, KAFKA_SEARCH_IDLE_TIMEOUT_MS)
      }
      const onAbort = () => finish(new Error('Request cancelled'))

      await consumer.connect()
      await consumer.subscribe({ topic: normalizedTopic, fromBeginning: true })
      signal?.addEventListener('abort', onAbort)
      if (signal?.aborted) onAbort()
      progressTimer = setInterval(flushProgress, KAFKA_SEARCH_PROGRESS_INTERVAL_MS)
      resetIdleTimer()

      consumer.on(consumer.events.GROUP_JOIN, ({ payload }) => {
        const assigned = payload.memberAssignment[normalizedTopic] ?? []
        for (const partition of assigned) {
          const start = starts.get(partition)
          const end = ends.get(partition)
          if (start === undefined || end === undefined || start >= end) {
            finished.add(partition)
          } else {
            consumer?.seek({ topic: normalizedTopic, partition, offset: start.toString() })
          }
        }
        if (assigned.length === 0 || finished.size === offsets.length) finish()
        else resetIdleTimer()
      })

      void consumer.run({
        autoCommit: false,
        partitionsConsumedConcurrently: Math.min(offsets.length, KAFKA_OFFSET_CONCURRENCY),
        eachBatch: async ({ batch, resolveOffset, heartbeat, isRunning, isStale }) => {
          resetIdleTimer()
          const start = starts.get(batch.partition)
          const end = ends.get(batch.partition)
          if (start === undefined || end === undefined) return

          let sinceYield = 0
          for (const message of batch.messages) {
            if (!isRunning() || isStale() || completed) return
            const offset = BigInt(message.offset)
            if (offset >= start && offset < end) {
              scanned += 1
              if (kafkaMessageMatches(normalizedTopic, batch.partition, message, normalizedQuery)) {
                const candidatePosition = {
                  timestamp: message.timestamp || null,
                  offset: message.offset,
                  partition: batch.partition,
                }
                let low = 0
                let high = messages.length
                while (low < high) {
                  const middle = Math.floor((low + high) / 2)
                  if (compareKafkaMessages(candidatePosition, messages[middle]) < 0) high = middle
                  else low = middle + 1
                }
                if (low < limit) {
                  messages.splice(
                    low,
                    0,
                    toKafkaMessage({ topic: normalizedTopic, partition: batch.partition, message }),
                  )
                  if (messages.length > limit) messages.pop()
                }
              }
              if (offset + 1n >= end) finished.add(batch.partition)
            }
            resolveOffset(message.offset)
            sinceYield += 1
            if (sinceYield >= KAFKA_SEARCH_BATCH_YIELD_SIZE) {
              sinceYield = 0
              await heartbeat()
              await new Promise<void>((resolve) => setImmediate(resolve))
            }
          }
          resetIdleTimer()
          if (finished.size === offsets.length) finish()
        },
      }).catch((reason: unknown) => {
        if (!completed) finish(reason instanceof Error ? reason : new Error(String(reason)))
      })

      try {
        await done
        flushProgress()
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
      return { messages, scanned }
    } finally {
      if (consumer) {
        await consumer.stop().catch(() => undefined)
        await consumer.disconnect().catch(() => undefined)
      }
    }
  }

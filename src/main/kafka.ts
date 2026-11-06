import { Kafka, logLevel, type Consumer, type EachMessagePayload } from 'kafkajs'
import type {
  KafkaMessageProduceInput,
  KafkaMessagesInput,
  KafkaTopicCreateInput,
} from '../shared/ipc'
import type {
  KafkaAuthConfig,
  KafkaConnectionInput,
  KafkaConsumerGroupInfo,
  KafkaConsumerGroupMember,
  KafkaMessage,
  KafkaPartitionInfo,
  KafkaTopicInfo,
  StoredKafkaConnection,
} from '../shared/types'

export type KafkaConnection = KafkaConnectionInput | StoredKafkaConnection

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

function createKafka(config: KafkaConnection): Kafka {
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

export async function testKafkaConnection(
  config: KafkaConnection,
): Promise<{ brokers: number; clusterId: string }> {
  const admin = createKafka(config).admin()
  try {
    await admin.connect()
    const cluster = await admin.describeCluster()
    return { brokers: cluster.brokers.length, clusterId: cluster.clusterId }
  } finally {
    await admin.disconnect()
  }
}

export async function listKafkaTopics(config: KafkaConnection): Promise<KafkaTopicInfo[]> {
  const admin = createKafka(config).admin()
  try {
    await admin.connect()
    const metadata = await admin.fetchTopicMetadata()
    return metadata.topics
      .map((topic) => ({ name: topic.name, partitions: topic.partitions.length }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } finally {
    await admin.disconnect()
  }
}

export async function createKafkaTopic(
  config: KafkaConnection,
  { topic, numPartitions, replicationFactor }: KafkaTopicCreateInput,
): Promise<boolean> {
  if (!topic.trim()) throw new Error('A Kafka topic name is required')
  if (!Number.isInteger(numPartitions) || numPartitions < 1)
    throw new Error('Partition count must be a positive integer')
  if (!Number.isInteger(replicationFactor) || replicationFactor < 1)
    throw new Error('Replication factor must be a positive integer')

  const admin = createKafka(config).admin()
  try {
    await admin.connect()
    return await admin.createTopics({
      topics: [{ topic: topic.trim(), numPartitions, replicationFactor }],
      waitForLeaders: true,
    })
  } finally {
    await admin.disconnect()
  }
}

export async function deleteKafkaTopic(config: KafkaConnection, topic: string): Promise<void> {
  if (!topic.trim()) throw new Error('A Kafka topic name is required')
  const admin = createKafka(config).admin()
  try {
    await admin.connect()
    await admin.deleteTopics({ topics: [topic.trim()] })
  } finally {
    await admin.disconnect()
  }
}

export async function fetchKafkaTopicPartitions(
  config: KafkaConnection,
  topic: string,
): Promise<KafkaPartitionInfo[]> {
  if (!topic.trim()) throw new Error('A Kafka topic name is required')
  const kafka = createKafka(config)
  const admin = kafka.admin()
  try {
    await admin.connect()
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
  } finally {
    await admin.disconnect()
  }
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
  config: KafkaConnection,
): Promise<KafkaConsumerGroupInfo[]> {
  const kafka = createKafka(config)
  const admin = kafka.admin()
  try {
    await admin.connect()
    const groupsResponse = await admin.listGroups()
    const groupIds = groupsResponse.groups.map((g) => g.groupId)
    if (groupIds.length === 0) return []

    const { groups: descriptions } = await admin.describeGroups(groupIds)

    // Fetch offsets for each group individually
    const offsetMap = new Map<string, Map<string, Map<number, string>>>()
    for (const groupId of groupIds) {
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
    }

    // Fetch high watermarks for all topics referenced by consumer groups
    const allTopics = new Set<string>()
    for (const desc of descriptions) {
      for (const member of desc.members) {
        const assignments = parseMemberAssignment(member.memberAssignment)
        for (const topic of Object.keys(assignments)) {
          allTopics.add(topic)
        }
      }
    }
    // Also add topics from offsets
    for (const topicMap of offsetMap.values()) {
      for (const topic of topicMap.keys()) {
        allTopics.add(topic)
      }
    }

    const topicHighOffsets = new Map<string, Map<number, string>>()
    for (const topic of allTopics) {
      try {
        const topicOffsets = await admin.fetchTopicOffsets(topic)
        const map = new Map<number, string>()
        for (const o of topicOffsets) {
          map.set(o.partition, o.high)
        }
        topicHighOffsets.set(topic, map)
      } catch {
        // Topic may not exist
      }
    }

    return descriptions.map((desc): KafkaConsumerGroupInfo => {
      const lag: Record<string, Record<string, number>> = {}
      const groupOffsets = offsetMap.get(desc.groupId)

      // Calculate lag from offsets (all topics the group consumes)
      if (groupOffsets) {
        for (const [topic, partitionMap] of groupOffsets) {
          const highMap = topicHighOffsets.get(topic)
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
            lag[topic] = topicLag
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
  } finally {
    await admin.disconnect()
  }
}

export async function produceKafkaMessage(
  config: KafkaConnection,
  { topic, key, value }: KafkaMessageProduceInput,
): Promise<void> {
  if (!topic.trim()) throw new Error('A Kafka topic is required')
  if (!value) throw new Error('A message value is required')

  const producer = createKafka(config).producer()
  try {
    await producer.connect()
    await producer.send({
      topic: topic.trim(),
      messages: [{ ...(key !== null ? { key } : {}), value }],
    })
  } finally {
    await producer.disconnect()
  }
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

function toKafkaMessage({ topic, partition, message }: EachMessagePayload): KafkaMessage {
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

export async function fetchKafkaMessages(
  config: KafkaConnection,
  { topic, limit }: KafkaMessagesInput,
): Promise<KafkaMessage[]> {
  if (!topic.trim()) throw new Error('A Kafka topic is required')
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Message limit must be between 1 and 100')

  const kafka = createKafka(config)
  const admin = kafka.admin()
  const groupId = `search-cluster-ui-${process.pid}-${Date.now()}`
  let consumer: Consumer | undefined

  try {
    await admin.connect()
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
    consumer = kafka.consumer({ groupId })
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
    consumer.on(consumer.events.GROUP_JOIN, ({ payload }) => {
      const assigned = payload.memberAssignment[topic] ?? []
      resetIdleTimer()
      for (const partition of assigned) {
        const start = starts.get(partition)
        if (start !== undefined) {
          if (start >= (endOffsets.get(partition) ?? 0n)) finished.add(partition)
          else consumer?.seek({ topic, partition, offset: start.toString() })
        }
        else finished.add(partition)
      }
      if (assigned.length === 0 || finished.size === offsets.length) finish()
    })
    void consumer.run({
      eachMessage: async (payload) => {
        const message = toKafkaMessage(payload)
        messages.push(message)
        resetIdleTimer()
        const end = endOffsets.get(payload.partition)
        if (end !== undefined && BigInt(payload.message.offset) + 1n >= end)
          finished.add(payload.partition)
        if (messages.length >= limit || finished.size === offsets.length) finish()
      },
    }).catch((reason: unknown) => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      if (idleTimer) clearTimeout(idleTimer)
      rejectDone(reason instanceof Error ? reason : new Error(String(reason)))
    })
    await done
    return messages.sort((a, b) => {
      const timeDiff = Number(b.timestamp ?? 0) - Number(a.timestamp ?? 0)
      if (timeDiff) return timeDiff
      const offsetA = BigInt(a.offset)
      const offsetB = BigInt(b.offset)
      return offsetA > offsetB ? -1 : offsetA < offsetB ? 1 : a.partition - b.partition
    })
  } finally {
    try {
      if (consumer) {
        await consumer.stop().catch(() => undefined)
        await consumer.disconnect()
      }
    } finally {
      await admin.disconnect()
    }
  }
}

import { ipcMain } from 'electron'
import { dialog } from 'electron'
import fs from 'node:fs/promises'
import {
  type AllocationExplainInput,
  IPC,
  type BulkInput,
  type ExplainInput,
  type KafkaMessageProduceInput,
  type KafkaMessagesInput,
  type KafkaTopicCreateInput,
  type MsearchInput,
  type RedisKeysScanInput,
  type RerouteInput,
  type SaveConnectionInput,
  type SearchInput,
  type SettingsUpdateInput,
  type SnapshotCreateInput,
  type SnapshotRestoreInput,
} from '../shared/ipc'
import type {
  ConnectionConfig,
  KafkaConnectionInput,
  RedisConnectionInput,
  RedisKeySaveInput,
  StoredConnection,
} from '../shared/types'
import { createClient, type ClusterClient } from './clients'
import { hitsToCsv, hitsToJson } from './exporters'
import type { ConnectionStore } from './store/connections'
import type { KafkaConnectionStore } from './store/kafka-connections'
import type { RedisConnectionStore } from './store/redis-connections'
import {
  createKafkaTopic,
  fetchKafkaMessages,
  listKafkaTopics,
  produceKafkaMessage,
  testKafkaConnection,
} from './kafka'
import {
  deleteRedisKey,
  fetchRedisServerInfo,
  getRedisKey,
  runRedisCommand,
  saveRedisKey,
  scanRedisKeys,
  testRedisConnection,
} from './redis'

/**
 * Cache of live clients keyed by connection id. Rebuilds a client whenever
 * its config (including credentials) changes.
 */
class ClientCache {
  private readonly entries = new Map<string, { client: ClusterClient; hash: string }>()

  get(id: string, connections: StoredConnection[]): ClusterClient {
    const cfg = connections.find((c) => c.id === id)
    if (!cfg) throw new Error(`Connection "${id}" not found`)

    const hash = JSON.stringify(cfg)
    const existing = this.entries.get(id)
    if (existing && existing.hash === hash) return existing.client

    existing?.client.close()
    const client = createClient(cfg)
    this.entries.set(id, { client, hash })
    return client
  }

  drop(id: string): void {
    this.entries.get(id)?.client.close()
    this.entries.delete(id)
  }
}

function toConfig(input: SaveConnectionInput): ConnectionConfig {
  return {
    id: input.id ?? 'draft',
    name: input.name,
    url: input.url,
    flavor: input.flavor,
    auth: input.auth,
    tlsVerify: input.tlsVerify,
    timeoutMs: input.timeoutMs,
  }
}

/**
 * AbortControllers for in-flight cluster requests, keyed by the requestId
 * the renderer passed with the call. AbortSignal cannot cross IPC, so the
 * renderer cancels through the request:cancel channel instead.
 */
class AbortRegistry {
  private readonly controllers = new Map<string, AbortController>()

  signalFor(requestId: string | undefined): AbortSignal | undefined {
    if (!requestId) return undefined
    const existing = this.controllers.get(requestId)
    if (existing) return existing.signal
    const controller = new AbortController()
    this.controllers.set(requestId, controller)
    return controller.signal
  }

  /** Drop the controller once the request settled; returns the signal's controller. */
  release(requestId: string | undefined): void {
    if (requestId) this.controllers.delete(requestId)
  }

  cancel(requestId: string): void {
    const controller = this.controllers.get(requestId)
    if (controller) {
      controller.abort()
      this.controllers.delete(requestId)
    }
  }
}

/** Registers every IPC channel. Called once after app.whenReady(). */
export function registerIpcHandlers(
  store: ConnectionStore,
  kafkaStore: KafkaConnectionStore,
  redisStore: RedisConnectionStore,
): void {
  const cache = new ClientCache()
  const clientFor = (id: string): ClusterClient => cache.get(id, store.list())
  const aborts = new AbortRegistry()
  const kafkaConfigFor = (id: string) => {
    const config = kafkaStore.list().find((connection) => connection.id === id)
    if (!config) throw new Error(`Kafka connection "${id}" not found`)
    return config
  }
  const redisConfigFor = (id: string) => {
    const config = redisStore.list().find((connection) => connection.id === id)
    if (!config) throw new Error(`Redis connection "${id}" not found`)
    return config
  }

  ipcMain.handle(IPC.RequestCancel, (_e, requestId: string) => {
    aborts.cancel(requestId)
  })

  ipcMain.handle(IPC.KafkaConnectionsList, () => kafkaStore.list())
  ipcMain.handle(IPC.KafkaConnectionsSave, (_e, input: KafkaConnectionInput) =>
    kafkaStore.save(input),
  )
  ipcMain.handle(IPC.KafkaConnectionsDelete, (_e, id: string) => kafkaStore.delete(id))
  ipcMain.handle(IPC.KafkaConnectionsTest, (_e, input: KafkaConnectionInput) =>
    testKafkaConnection(input),
  )
  ipcMain.handle(IPC.KafkaTopics, (_e, id: string) => listKafkaTopics(kafkaConfigFor(id)))
  ipcMain.handle(IPC.KafkaTopicCreate, (_e, id: string, input: KafkaTopicCreateInput) =>
    createKafkaTopic(kafkaConfigFor(id), input),
  )
  ipcMain.handle(IPC.KafkaMessages, (_e, id: string, input: KafkaMessagesInput) =>
    fetchKafkaMessages(kafkaConfigFor(id), input),
  )
  ipcMain.handle(IPC.KafkaMessageProduce, (_e, id: string, input: KafkaMessageProduceInput) =>
    produceKafkaMessage(kafkaConfigFor(id), input),
  )
  ipcMain.handle(IPC.RedisConnectionsList, () => redisStore.list())
  ipcMain.handle(IPC.RedisConnectionsSave, (_e, input: RedisConnectionInput) =>
    redisStore.save(input),
  )
  ipcMain.handle(IPC.RedisConnectionsDelete, (_e, id: string) => redisStore.delete(id))
  ipcMain.handle(IPC.RedisConnectionsTest, (_e, input: RedisConnectionInput) =>
    testRedisConnection(input),
  )
  ipcMain.handle(IPC.RedisKeysScan, (_e, id: string, input: RedisKeysScanInput) =>
    scanRedisKeys(redisConfigFor(id), input),
  )
  ipcMain.handle(IPC.RedisKeyGet, (_e, id: string, key: string) =>
    getRedisKey(redisConfigFor(id), key),
  )
  ipcMain.handle(IPC.RedisKeySave, (_e, id: string, input: RedisKeySaveInput) =>
    saveRedisKey(redisConfigFor(id), input),
  )
  ipcMain.handle(IPC.RedisKeyDelete, (_e, id: string, key: string) =>
    deleteRedisKey(redisConfigFor(id), key),
  )
  ipcMain.handle(IPC.RedisCommand, (_e, id: string, command: string) =>
    runRedisCommand(redisConfigFor(id), command),
  )
  ipcMain.handle(IPC.RedisServerInfo, (_e, id: string) =>
    fetchRedisServerInfo(redisConfigFor(id)),
  )

  ipcMain.handle(IPC.ConnectionsList, () => store.list())
  ipcMain.handle(IPC.ConnectionsSave, (_e, input: SaveConnectionInput) => store.save(input))
  ipcMain.handle(IPC.ConnectionsDelete, (_e, id: string) => {
    store.delete(id)
    cache.drop(id)
  })
  ipcMain.handle(IPC.ConnectionsTest, (_e, input: SaveConnectionInput) => {
    const client = createClient(toConfig(input))
    return client.ping().finally(() => client.close())
  })
  ipcMain.handle(IPC.ClusterOverview, (_e, id: string, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .overview(signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterIndices, (_e, id: string, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .indices(signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterIndexDetail, (_e, id: string, indexName: string, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .indexDetail(indexName, signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterSearch, (_e, id: string, input: SearchInput, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .search(input.index, input.body ?? null, signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterExplain, (_e, id: string, input: ExplainInput, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .explain(input.index, input.docId, input.body ?? null, signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterIndexDelete, (_e, id: string, indexName: string) =>
    clientFor(id).deleteIndex(indexName),
  )
  ipcMain.handle(IPC.ClusterIndexClear, (_e, id: string, indexName: string) =>
    clientFor(id).clearIndex(indexName),
  )
  ipcMain.handle(
    IPC.ClusterDocumentDelete,
    (_e, id: string, indexName: string, docId: string) =>
      clientFor(id).deleteDocument(indexName, docId),
  )
  ipcMain.handle(
    IPC.ClusterDocumentGet,
    (_e, id: string, indexName: string, docId: string, requestId?: string) => {
      const signal = aborts.signalFor(requestId)
      return clientFor(id)
        .getDocument(indexName, docId, signal)
        .finally(() => aborts.release(requestId))
    },
  )
  ipcMain.handle(
    IPC.ClusterDocumentSave,
    (_e, id: string, indexName: string, docId: string, source: Record<string, unknown>) =>
      clientFor(id).saveDocument(indexName, docId, source),
  )
  ipcMain.handle(
    IPC.ClusterDocumentCreate,
    (_e, id: string, indexName: string, source: Record<string, unknown>) =>
      clientFor(id).createDocument(indexName, source),
  )
  ipcMain.handle(IPC.ClusterBulk, (_e, id: string, input: BulkInput) =>
    clientFor(id).bulk(input.index ?? null, input.ndjson),
  )
  ipcMain.handle(
    IPC.ClusterExport,
    async (
      _e,
      id: string,
      input: SearchInput,
      format: 'csv' | 'json',
      options?: { columns?: string[] | null; flatten?: boolean },
      requestId?: string,
    ) => {
      const signal = aborts.signalFor(requestId)
      try {
        const hits = await clientFor(id).searchAll(input.index, input.body ?? null, signal)
        const content =
          format === 'csv' ? hitsToCsv(hits, options) : hitsToJson(hits)
        const defaultName = `export-${input.index.replace(/[\\/:*?"<>|]/g, '_')}-${Date.now()}.${format}`
        const { canceled, filePath } = await dialog.showSaveDialog({
          defaultPath: defaultName,
          filters: [
            format === 'csv'
              ? { name: 'CSV', extensions: ['csv'] }
              : { name: 'JSON', extensions: ['json'] },
          ],
        })
        if (canceled || !filePath) return null
        await fs.writeFile(filePath, content, 'utf8')
        return filePath
      } finally {
        aborts.release(requestId)
      }
    },
  )
  ipcMain.handle(IPC.ClusterIndexOpen, (_e, id: string, indexName: string) =>
    clientFor(id).openIndex(indexName),
  )
  ipcMain.handle(IPC.ClusterIndexClose, (_e, id: string, indexName: string) =>
    clientFor(id).closeIndex(indexName),
  )
  ipcMain.handle(IPC.ClusterAliasAdd, (_e, id: string, indexName: string, alias: string) =>
    clientFor(id).addAlias(indexName, alias),
  )
  ipcMain.handle(IPC.ClusterAliasRemove, (_e, id: string, indexName: string, alias: string) =>
    clientFor(id).removeAlias(indexName, alias),
  )
  ipcMain.handle(
    IPC.ClusterReindex,
    (_e, id: string, source: string, dest: string, body: Record<string, unknown> | null) =>
      clientFor(id).reindex(source, dest, body ?? null),
  )
  ipcMain.handle(IPC.ClusterShards, (_e, id: string, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .shards(signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterSnapshots, (_e, id: string, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .snapshots(signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterRepositories, (_e, id: string, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .repositories(signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterSnapshotCreate, (_e, id: string, input: SnapshotCreateInput) =>
    clientFor(id).createSnapshot(input.repository, input.snapshot, input.indices, input.body ?? null),
  )
  ipcMain.handle(
    IPC.ClusterSnapshotDelete,
    (_e, id: string, repository: string, snapshot: string) =>
      clientFor(id).deleteSnapshot(repository, snapshot),
  )
  ipcMain.handle(IPC.ClusterSnapshotRestore, (_e, id: string, input: SnapshotRestoreInput) =>
    clientFor(id).restoreSnapshot(input.repository, input.snapshot, input.body ?? null),
  )
  ipcMain.handle(
    IPC.ClusterAllocationExplain,
    (_e, id: string, input: AllocationExplainInput, requestId?: string) => {
      const signal = aborts.signalFor(requestId)
      return clientFor(id)
        .allocationExplain(input.index, input.shard, input.primary, signal)
        .finally(() => aborts.release(requestId))
    },
  )
  ipcMain.handle(IPC.ClusterReroute, (_e, id: string, input: RerouteInput) =>
    clientFor(id).reroute(input.commands),
  )
  ipcMain.handle(IPC.ClusterSettingsGet, (_e, id: string, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .clusterSettings(signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterSettingsUpdate, (_e, id: string, input: SettingsUpdateInput) =>
    clientFor(id).updateClusterSettings(input.persistent ?? null, input.transient ?? null),
  )
  ipcMain.handle(IPC.ClusterIndexTemplates, (_e, id: string, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .indexTemplates(signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterComponentTemplates, (_e, id: string, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .componentTemplates(signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(
    IPC.ClusterIndexTemplateSave,
    (_e, id: string, name: string, body: Record<string, unknown>) =>
      clientFor(id).saveIndexTemplate(name, body),
  )
  ipcMain.handle(IPC.ClusterIndexTemplateDelete, (_e, id: string, name: string) =>
    clientFor(id).deleteIndexTemplate(name),
  )
  ipcMain.handle(
    IPC.ClusterComponentTemplateSave,
    (_e, id: string, name: string, body: Record<string, unknown>) =>
      clientFor(id).saveComponentTemplate(name, body),
  )
  ipcMain.handle(IPC.ClusterComponentTemplateDelete, (_e, id: string, name: string) =>
    clientFor(id).deleteComponentTemplate(name),
  )
  ipcMain.handle(
    IPC.ClusterSimulateIndexTemplate,
    (_e, id: string, templateName: string, indexName: string | null, requestId?: string) => {
      const signal = aborts.signalFor(requestId)
      return clientFor(id)
        .simulateIndexTemplate(templateName, indexName, signal)
        .finally(() => aborts.release(requestId))
    },
  )
  ipcMain.handle(
    IPC.ClusterCreateIndexFromTemplate,
    (_e, id: string, indexName: string, body: Record<string, unknown> | null) =>
      clientFor(id).createIndexFromTemplate(indexName, body ?? null),
  )
  ipcMain.handle(IPC.ClusterIlmPolicies, (_e, id: string, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .ilmPolicies(signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterIlmExplain, (_e, id: string, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .ilmExplain(signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterDataStreams, (_e, id: string, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .dataStreams(signal)
      .finally(() => aborts.release(requestId))
  })
  ipcMain.handle(IPC.ClusterMsearch, (_e, id: string, input: MsearchInput, requestId?: string) => {
    const signal = aborts.signalFor(requestId)
    return clientFor(id)
      .msearch(input.index ?? null, input.ndjson, signal)
      .finally(() => aborts.release(requestId))
  })
}

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { RedisConnectionInput, StoredRedisConnection } from '../../shared/types'

interface SecretsBox {
  encrypted: boolean
  payload: string
}

interface PersistedConnection {
  id: string
  name: string
  topology: RedisConnectionInput['topology']
  host: string
  port: number
  db: number
  nodes: string
  masterName: string
  timeoutMs: number
  createdAt: number
  updatedAt: number
  secrets: SecretsBox
}

interface PersistedFile {
  version: number
  connections: PersistedConnection[]
}

type ConnectionSecrets = Pick<
  RedisConnectionInput,
  'username' | 'password' | 'sentinelUsername' | 'sentinelPassword' | 'tls'
>

const EMPTY_SECRETS: ConnectionSecrets = {
  username: '',
  password: '',
  sentinelUsername: '',
  sentinelPassword: '',
  tls: { enabled: false, rejectUnauthorized: true, ca: '', cert: '', key: '' },
}

export class RedisConnectionStore {
  private readonly file = path.join(app.getPath('userData'), 'redis-connections.json')

  list(): StoredRedisConnection[] {
    return this.read().connections.map((connection) => {
      const { id, name, topology, host, port, db, nodes, masterName, timeoutMs, createdAt, updatedAt } =
        connection
      return {
        id,
        name,
        topology,
        host,
        port,
        db,
        nodes,
        masterName,
        timeoutMs,
        createdAt,
        updatedAt,
        ...this.decrypt(connection.secrets),
      }
    })
  }

  save(input: RedisConnectionInput): StoredRedisConnection {
    if (typeof input.name !== 'string' || !input.name.trim())
      throw new Error('Connection name is required')
    if (!['standalone', 'cluster', 'sentinel'].includes(input.topology))
      throw new Error('Invalid Redis topology')
    if (typeof input.host !== 'string' || (input.topology === 'standalone' && !input.host.trim()))
      throw new Error('Redis host is required')
    if (typeof input.nodes !== 'string' || typeof input.masterName !== 'string')
      throw new Error('Invalid Redis topology settings')
    if (
      typeof input.username !== 'string' ||
      typeof input.password !== 'string' ||
      typeof input.sentinelUsername !== 'string' ||
      typeof input.sentinelPassword !== 'string'
    )
      throw new Error('Invalid Redis authentication settings')
    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
      throw new Error('Port must be between 1 and 65535')
    if (!Number.isInteger(input.db) || input.db < 0)
      throw new Error('Database number must be a non-negative integer')
    if (input.topology !== 'standalone' && !input.nodes?.trim())
      throw new Error('At least one Redis node is required')
    if (input.topology === 'sentinel' && !input.masterName?.trim())
      throw new Error('Sentinel master name is required')
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000)
      throw new Error('Timeout must be at least 1000 ms')
    if (
      !input.tls ||
      typeof input.tls.enabled !== 'boolean' ||
      typeof input.tls.rejectUnauthorized !== 'boolean' ||
      typeof input.tls.ca !== 'string' ||
      typeof input.tls.cert !== 'string' ||
      typeof input.tls.key !== 'string'
    )
      throw new Error('Invalid TLS settings')
    if (Boolean(input.tls.cert.trim()) !== Boolean(input.tls.key.trim()))
      throw new Error('Both client certificate and private key are required for mutual TLS')

    const file = this.read()
    const now = Date.now()
    const existing = input.id ? file.connections.find((item) => item.id === input.id) : undefined
    const id = existing?.id ?? randomUUID()
    const connection: PersistedConnection = {
      id,
      name: input.name.trim(),
      topology: input.topology,
      host: input.host.trim(),
      port: input.port,
      db: input.db,
      nodes: input.nodes.trim(),
      masterName: input.masterName.trim(),
      timeoutMs: input.timeoutMs,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      secrets: this.encrypt({
        username: input.username,
        password: input.password,
        sentinelUsername: input.sentinelUsername,
        sentinelPassword: input.sentinelPassword,
        tls: input.tls,
      }),
    }
    const connections = [...file.connections.filter((item) => item.id !== id), connection].sort(
      (a, b) => a.name.localeCompare(b.name),
    )
    this.write({ version: file.version, connections })
    return {
      id,
      name: connection.name,
      topology: connection.topology,
      host: connection.host,
      port: connection.port,
      db: connection.db,
      nodes: connection.nodes,
      masterName: connection.masterName,
      timeoutMs: connection.timeoutMs,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      ...this.decrypt(connection.secrets),
    }
  }

  delete(id: string): void {
    const file = this.read()
    this.write({ version: file.version, connections: file.connections.filter((item) => item.id !== id) })
  }

  private read(): PersistedFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as PersistedFile
      if (parsed && Array.isArray(parsed.connections))
        return { version: parsed.version ?? 1, connections: parsed.connections }
    } catch {
      // The store is optional on first launch.
    }
    return { version: 1, connections: [] }
  }

  private write(file: PersistedFile): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(file, null, 2), 'utf8')
  }

  private encrypt(secrets: ConnectionSecrets): SecretsBox {
    const json = JSON.stringify(secrets)
    if (safeStorage.isEncryptionAvailable())
      return { encrypted: true, payload: safeStorage.encryptString(json).toString('base64') }
    return { encrypted: false, payload: Buffer.from(json, 'utf8').toString('base64') }
  }

  private decrypt(box: SecretsBox): ConnectionSecrets {
    try {
      const json = box.encrypted
        ? safeStorage.decryptString(Buffer.from(box.payload, 'base64'))
        : Buffer.from(box.payload, 'base64').toString('utf8')
      return JSON.parse(json) as ConnectionSecrets
    } catch {
      console.warn('Failed to decrypt Redis credentials; resetting connection security settings.')
      return EMPTY_SECRETS
    }
  }
}

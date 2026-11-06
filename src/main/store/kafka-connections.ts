import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type {
  KafkaAuthConfig,
  KafkaConnectionInput,
  KafkaTlsConfig,
  StoredKafkaConnection,
} from '../../shared/types'

interface SecretsBox {
  encrypted: boolean
  payload: string
}

interface PersistedConnection {
  id: string
  name: string
  brokers: string
  timeoutMs: number
  createdAt: number
  updatedAt: number
  secrets: SecretsBox
}

interface PersistedFile {
  version: number
  connections: PersistedConnection[]
}

interface ConnectionSecrets {
  auth: KafkaAuthConfig | null
  tls: KafkaTlsConfig
}

const EMPTY_TLS: KafkaTlsConfig = {
  enabled: false,
  rejectUnauthorized: true,
  ca: '',
  cert: '',
  key: '',
  passphrase: '',
}

export class KafkaConnectionStore {
  private readonly file = path.join(app.getPath('userData'), 'kafka-connections.json')

  list(): StoredKafkaConnection[] {
    return this.read().connections.map((connection) => {
      const { auth, tls } = this.decrypt(connection.secrets)
      const { id, name, brokers, timeoutMs, createdAt, updatedAt } = connection
      return { id, name, brokers, timeoutMs, createdAt, updatedAt, auth, tls }
    })
  }

  save(input: KafkaConnectionInput): StoredKafkaConnection {
    if (!input.name?.trim()) throw new Error('Connection name is required')
    if (!input.brokers?.trim()) throw new Error('At least one Kafka broker is required')
    if (!Number.isFinite(input.timeoutMs) || input.timeoutMs < 1000)
      throw new Error('Timeout must be at least 1000 ms')
    if (input.auth && (!input.auth.username.trim() || !input.auth.password))
      throw new Error('SASL username and password are required')
    if (Boolean(input.tls.cert.trim()) !== Boolean(input.tls.key.trim()))
      throw new Error('Both client certificate and private key are required for mutual TLS')

    const file = this.read()
    const now = Date.now()
    const existing = input.id ? file.connections.find((item) => item.id === input.id) : undefined
    const id = existing?.id ?? randomUUID()
    const connection: PersistedConnection = {
      id,
      name: input.name.trim(),
      brokers: input.brokers.trim(),
      timeoutMs: input.timeoutMs,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      secrets: this.encrypt({ auth: input.auth, tls: input.tls }),
    }

    const connections = [...file.connections.filter((item) => item.id !== id), connection].sort(
      (a, b) => a.name.localeCompare(b.name),
    )
    this.write({ version: file.version, connections })
    return {
      id,
      name: connection.name,
      brokers: connection.brokers,
      timeoutMs: connection.timeoutMs,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      auth: input.auth,
      tls: input.tls,
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
      console.warn('Failed to decrypt Kafka credentials; resetting connection security settings.')
      return { auth: null, tls: { ...EMPTY_TLS } }
    }
  }
}

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'
import type { SaveConnectionInput } from '../../shared/ipc'
import type { AuthConfig, ClusterFlavor, StoredConnection } from '../../shared/types'

/**
 * Connection persistence: a JSON file in the app's userData dir.
 * The `auth` object is stored as an opaque box — encrypted with the OS
 * keychain via safeStorage when available, base64 JSON otherwise.
 */

interface AuthBox {
  encrypted: boolean
  payload: string
}

interface PersistedConnection {
  id: string
  name: string
  url: string
  flavor: ClusterFlavor
  tlsVerify: boolean
  timeoutMs: number
  createdAt: number
  updatedAt: number
  auth: AuthBox
}

interface PersistedFile {
  version: number
  connections: PersistedConnection[]
}

export class ConnectionStore {
  private readonly file: string

  constructor() {
    this.file = path.join(app.getPath('userData'), 'connections.json')
  }

  list(): StoredConnection[] {
    return this.read().connections.map((c) => ({
      id: c.id,
      name: c.name,
      url: c.url,
      flavor: c.flavor,
      tlsVerify: c.tlsVerify,
      timeoutMs: c.timeoutMs,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      auth: this.decryptAuth(c.auth),
    }))
  }

  save(input: SaveConnectionInput): StoredConnection {
    if (!input.name?.trim()) throw new Error('Connection name is required')
    if (!input.url?.trim()) throw new Error('Connection URL is required')

    const file = this.read()
    const now = Date.now()
    const existing = input.id ? file.connections.find((c) => c.id === input.id) : undefined
    const id = existing?.id ?? randomUUID()

    const persisted: PersistedConnection = {
      id,
      name: input.name.trim(),
      url: input.url.trim().replace(/\/+$/, ''),
      flavor: input.flavor,
      tlsVerify: input.tlsVerify,
      timeoutMs: input.timeoutMs,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      auth: this.encryptAuth(input.auth),
    }

    const connections = [...file.connections.filter((c) => c.id !== id), persisted].sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    this.write({ version: file.version, connections })

    return {
      id,
      name: persisted.name,
      url: persisted.url,
      flavor: persisted.flavor,
      tlsVerify: persisted.tlsVerify,
      timeoutMs: persisted.timeoutMs,
      createdAt: persisted.createdAt,
      updatedAt: persisted.updatedAt,
      auth: input.auth,
    }
  }

  delete(id: string): void {
    const file = this.read()
    this.write({ version: file.version, connections: file.connections.filter((c) => c.id !== id) })
  }

  private read(): PersistedFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as PersistedFile
      if (parsed && Array.isArray(parsed.connections)) {
        return { version: parsed.version ?? 1, connections: parsed.connections }
      }
    } catch {
      // Missing or corrupted file — start fresh.
    }
    return { version: 1, connections: [] }
  }

  private write(file: PersistedFile): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    fs.writeFileSync(this.file, JSON.stringify(file, null, 2), 'utf8')
  }

  private encryptAuth(auth: AuthConfig): AuthBox {
    const json = JSON.stringify(auth)
    if (safeStorage.isEncryptionAvailable()) {
      return { encrypted: true, payload: safeStorage.encryptString(json).toString('base64') }
    }
    // Fallback: obfuscated storage; noted in the README.
    return { encrypted: false, payload: Buffer.from(json, 'utf8').toString('base64') }
  }

  private decryptAuth(box: AuthBox): AuthConfig {
    try {
      const json = box.encrypted
        ? safeStorage.decryptString(Buffer.from(box.payload, 'base64'))
        : Buffer.from(box.payload, 'base64').toString('utf8')
      return JSON.parse(json) as AuthConfig
    } catch {
      // e.g. the OS keychain key rotated — keep the connection editable, drop secrets.
      console.warn('Failed to decrypt stored credentials; resetting auth to anonymous.')
      return { kind: 'none' }
    }
  }
}

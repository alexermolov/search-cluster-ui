import http from 'node:http'
import https from 'node:https'
import type { ConnectionConfig } from '../../shared/types'
import { signAwsRequest } from './sigv4'

/** Error with the HTTP status and parsed body of the cluster response. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: unknown,
    /** Retry-After header converted to ms, when the cluster sent one (429/503). */
    readonly retryAfterMs?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Request cancelled through its AbortSignal (e.g. the user switched connections). */
export class AbortedError extends Error {
  constructor() {
    super('Request aborted')
    this.name = 'AbortError'
  }
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Statuses worth retrying — typical for AWS-managed clusters under throttling. */
const RETRYABLE_STATUSES = new Set([429, 503])
const MAX_RETRIES = 3
const BASE_DELAY_MS = 500
const MAX_DELAY_MS = 10_000

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AbortedError())
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new AbortedError())
      },
      { once: true },
    )
  })
}

/**
 * Low-level HTTP transport to a cluster. Runs in the main process only —
 * the renderer never talks to clusters directly. Built on node:http(s) so we
 * control TLS verification and timeouts without extra dependencies.
 *
 * Retries idempotent (GET) requests on 429/503 with exponential backoff and
 * jitter, honoring the Retry-After header when the cluster sends one.
 */
export class ClusterHttp {
  private agent: https.Agent | null = null

  constructor(private readonly cfg: ConnectionConfig) {}

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    contentType?: string,
  ): Promise<T> {
    const idempotent = method.toUpperCase() === 'GET'
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.doRequest<T>(method, path, body, signal, contentType)
      } catch (e) {
        if (signal?.aborted) throw new AbortedError()
        const retryable = idempotent && e instanceof ApiError && RETRYABLE_STATUSES.has(e.status)
        if (!retryable || attempt >= MAX_RETRIES) throw e
        const backoff = BASE_DELAY_MS * 2 ** attempt + Math.floor(Math.random() * 250)
        const delay = Math.min(Math.max(e.retryAfterMs ?? backoff, backoff), MAX_DELAY_MS)
        await sleep(delay, signal)
      }
    }
  }

  private doRequest<T>(
    method: string,
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    contentType: string | undefined,
  ): Promise<T> {
    const base = this.cfg.url.replace(/\/+$/, '')
    const url = new URL(base + path)
    const isHttps = url.protocol === 'https:'

    const headers: Record<string, string> = { accept: 'application/json' }
    // String bodies (e.g. NDJSON for _bulk) are sent as-is.
    const payload =
      body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)
    if (payload !== undefined) headers['content-type'] = contentType ?? 'application/json'

    this.applyAuth(method, url, headers, payload)

    const timeoutMs = this.cfg.timeoutMs > 0 ? this.cfg.timeoutMs : 10_000

    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new AbortedError())
        return
      }

      let cleanup = (): void => {}
      const req = (isHttps ? https : http).request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          method: method.toUpperCase(),
          path: url.pathname + url.search,
          headers,
          agent: isHttps ? this.getAgent() : undefined,
        },
        (res) => {
          cleanup()
          const chunks: Buffer[] = []
          res.on('data', (c: Buffer) => chunks.push(c))
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8')
            const status = res.statusCode ?? 0
            if (status >= 400) {
              const ra = res.headers['retry-after']
              const raSec = typeof ra === 'string' ? Number(ra) : NaN
              const retryAfterMs = Number.isFinite(raSec) && raSec > 0 ? raSec * 1000 : undefined
              reject(
                new ApiError(
                  `HTTP ${status}: ${text.slice(0, 400)}`,
                  status,
                  safeParse(text),
                  retryAfterMs,
                ),
              )
              return
            }
            if (!text) {
              resolve(undefined as T)
              return
            }
            resolve(safeParse(text) as T)
          })
        },
      )

      const onAbort = () => req.destroy(new AbortedError())
      cleanup = () => signal?.removeEventListener('abort', onAbort)
      signal?.addEventListener('abort', onAbort, { once: true })

      req.setTimeout(timeoutMs, () => req.destroy(new Error(`Request timed out after ${timeoutMs}ms`)))
      req.on('error', (err) => {
        cleanup()
        reject(signal?.aborted ? new AbortedError() : err)
      })
      if (payload !== undefined) req.write(payload)
      req.end()
    })
  }

  private getAgent(): https.Agent {
    if (!this.agent) {
      this.agent = new https.Agent({ rejectUnauthorized: this.cfg.tlsVerify !== false })
    }
    return this.agent
  }

  private applyAuth(method: string, url: URL, headers: Record<string, string>, payload: string | undefined): void {
    const auth = this.cfg.auth
    if (auth.kind === 'basic') {
      headers['authorization'] = 'Basic ' + Buffer.from(`${auth.username}:${auth.password}`).toString('base64')
    } else if (auth.kind === 'bearer') {
      headers['authorization'] = `Bearer ${auth.token}`
    } else if (auth.kind === 'aws') {
      signAwsRequest({ method, url, headers, body: payload, credentials: auth })
    }
  }

  close(): void {
    this.agent?.destroy()
    this.agent = null
  }
}

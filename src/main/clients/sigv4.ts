import crypto from 'node:crypto'

/**
 * Minimal AWS Signature V4 signer for OpenSearch clusters hosted on AWS
 * (service 'es') and OpenSearch Serverless (service 'aoss').
 * Mutates `headers` in place (adds host, x-amz-* and authorization headers).
 */

interface SigV4Options {
  method: string
  url: URL
  headers: Record<string, string>
  body?: string
  credentials: {
    accessKeyId: string
    secretAccessKey: string
    sessionToken?: string
    region: string
    service?: string
  }
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex')
}

export function signAwsRequest({ method, url, headers, body, credentials }: SigV4Options): void {
  const service = credentials.service || 'es'
  const region = credentials.region || 'us-east-1'

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '') // 20260929T121212Z
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256Hex(body ?? '')

  headers['host'] = url.host
  headers['x-amz-date'] = amzDate
  headers['x-amz-content-sha256'] = payloadHash
  if (credentials.sessionToken) headers['x-amz-security-token'] = credentials.sessionToken

  // Canonical headers: lowercase names, trimmed values, sorted.
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = String(v).trim()
  const signedNames = Object.keys(lower).sort()
  const canonicalHeaders = signedNames.map((n) => `${n}:${lower[n]}\n`).join('')
  const signedHeaders = signedNames.join(';')

  const canonicalUri = url.pathname || '/'
  const canonicalQuery = [...url.searchParams.entries()]
    .map(([k, v]) => [encodeURIComponent(k), encodeURIComponent(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n')

  const kSigning = hmac(hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, dateStamp), region), service), 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`
}

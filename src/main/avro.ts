import avro from 'avsc'

export function parseAvroSchema(schema: string): { valid: boolean; error?: string } {
  try {
    avro.Type.forSchema(JSON.parse(schema))
    return { valid: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { valid: false, error: msg }
  }
}

export function serializeAvro(schemaJson: string, data: unknown): Buffer {
  const type = avro.Type.forSchema(JSON.parse(schemaJson))
  return type.toBuffer(data as Record<string, unknown>)
}

export function decodeAvro(schemaJson: string, buffer: Buffer): unknown {
  const type = avro.Type.forSchema(JSON.parse(schemaJson))
  return type.fromBuffer(buffer)
}

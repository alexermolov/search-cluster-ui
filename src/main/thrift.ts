import thriftParser from 'thrift-parser'

export interface ThriftAST {
  struct?: Record<string, ThriftField[]>
  exception?: Record<string, ThriftField[]>
  union?: Record<string, ThriftField[]>
  enum?: Record<string, { items: Array<{ name: string; value: number }> }>
  typedef?: Record<string, { type: ThriftType }>
}

export type ThriftType =
  | string
  | { name: 'list'; valueType: ThriftType }
  | { name: 'set'; valueType: ThriftType }
  | { name: 'map'; keyType: ThriftType; valueType: ThriftType }

export interface ThriftField {
  id: number
  name: string
  type: ThriftType
  option?: 'required' | 'optional'
}

export function parseThriftIDL(idl: string): ThriftAST {
  try {
    return thriftParser(idl) as ThriftAST
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse Thrift IDL: ${message}`)
  }
}

export function getThriftStructNames(ast: ThriftAST): string[] {
  const names = [
    ...Object.keys(ast.struct ?? {}),
    ...Object.keys(ast.exception ?? {}),
    ...Object.keys(ast.union ?? {}),
  ]
  return names.sort()
}

/* ─── TBinaryProtocol writer ─── */

class ThriftBinaryWriter {
  private chunks: Buffer[] = []
  private length = 0

  writeByte(v: number) {
    const buf = Buffer.allocUnsafe(1)
    buf.writeUInt8(v & 0xff, 0)
    this.chunks.push(buf)
    this.length += 1
  }

  writeI16(v: number) {
    const buf = Buffer.allocUnsafe(2)
    buf.writeInt16BE(v, 0)
    this.chunks.push(buf)
    this.length += 2
  }

  writeI32(v: number) {
    const buf = Buffer.allocUnsafe(4)
    buf.writeInt32BE(v, 0)
    this.chunks.push(buf)
    this.length += 4
  }

  writeI64(v: bigint | number) {
    const buf = Buffer.allocUnsafe(8)
    const big = typeof v === 'bigint' ? v : BigInt(v)
    buf.writeBigInt64BE(big, 0)
    this.chunks.push(buf)
    this.length += 8
  }

  writeDouble(v: number) {
    const buf = Buffer.allocUnsafe(8)
    buf.writeDoubleBE(v, 0)
    this.chunks.push(buf)
    this.length += 8
  }

  writeString(v: string) {
    const bytes = Buffer.from(v, 'utf8')
    this.writeI32(bytes.length)
    this.chunks.push(bytes)
    this.length += bytes.length
  }

  writeBool(v: boolean) {
    this.writeByte(v ? 1 : 0)
  }

  finish(): Buffer {
    return Buffer.concat(this.chunks, this.length)
  }
}

function getTypeId(type: ThriftType, ast: ThriftAST): number {
  if (typeof type === 'string') {
    // Resolve typedefs transparently.
    if (ast.typedef && ast.typedef[type]) {
      return getTypeId(ast.typedef[type].type, ast)
    }

    switch (type) {
      case 'bool':
        return 2
      case 'byte':
      case 'i8':
        return 3
      case 'double':
        return 4
      case 'i16':
        return 6
      case 'int':
      case 'i32':
        return 8
      case 'i64':
        return 10
      case 'string':
      case 'binary':
        return 11
      default:
        if (ast.enum && ast.enum[type]) return 8
        if (ast.struct && ast.struct[type]) return 12
        if (ast.exception && ast.exception[type]) return 12
        if (ast.union && ast.union[type]) return 12
        throw new Error(`Unknown type: ${type}`)
    }
  }

  switch (type.name) {
    case 'list':
      return 15
    case 'set':
      return 14
    case 'map':
      return 13
    default:
      throw new Error(`Unknown container type: ${(type as any).name}`)
  }
}

/* ─── Value serialization ─── */

function numberValue(value: unknown, type: string): number {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  ) {
    throw new Error(`Expected number for ${type}, got ${value}`)
  }
  const num = Number(value)
  if (!Number.isFinite(num)) throw new Error(`Expected finite number for ${type}, got ${value}`)
  return num
}

function writeValue(writer: ThriftBinaryWriter, value: unknown, type: ThriftType, ast: ThriftAST) {
  if (typeof type === 'string') {
    if (ast.typedef && ast.typedef[type]) {
      writeValue(writer, value, ast.typedef[type].type, ast)
      return
    }

    switch (type) {
      case 'bool': {
        if (typeof value !== 'boolean') throw new Error(`Expected boolean, got ${typeof value}`)
        writer.writeBool(value)
        return
      }
      case 'byte':
      case 'i8': {
        const num = numberValue(value, type)
        if (!Number.isInteger(num) || num < -128 || num > 127) {
          throw new Error(`Expected a signed 8-bit integer for ${type}, got ${value}`)
        }
        writer.writeByte(num)
        return
      }
      case 'i16': {
        const num = numberValue(value, type)
        if (!Number.isInteger(num) || num < -32768 || num > 32767) {
          throw new Error(`Expected a signed 16-bit integer, got ${value}`)
        }
        writer.writeI16(num)
        return
      }
      case 'int':
      case 'i32': {
        const num = numberValue(value, type)
        if (!Number.isInteger(num) || num < -2147483648 || num > 2147483647) {
          throw new Error(`Expected a signed 32-bit integer, got ${value}`)
        }
        writer.writeI32(num)
        return
      }
      case 'i64': {
        if (typeof value === 'bigint') {
          writer.writeI64(value)
        } else if (typeof value === 'number') {
          if (!Number.isSafeInteger(value)) {
            throw new Error(`Expected a safe integer or decimal string for i64, got ${value}`)
          }
          writer.writeI64(value)
        } else if (typeof value === 'string') {
          if (!/^[+-]?\d+$/.test(value)) {
            throw new Error(`Expected a decimal integer string for i64, got ${value}`)
          }
          writer.writeI64(BigInt(value))
        } else {
          throw new Error(`Expected bigint/number/string for i64, got ${typeof value}`)
        }
        return
      }
      case 'double': {
        const num = numberValue(value, type)
        writer.writeDouble(num)
        return
      }
      case 'string':
      case 'binary': {
        if (typeof value !== 'string') throw new Error(`Expected string, got ${typeof value}`)
        writer.writeString(value)
        return
      }
      default: {
        if (ast.enum && ast.enum[type]) {
          const enumItem =
            typeof value === 'string'
              ? ast.enum[type].items.find((item) => item.name === value)
              : undefined
          const num = enumItem?.value ?? numberValue(value, `enum ${type}`)
          if (!Number.isInteger(num) || num < -2147483648 || num > 2147483647) {
            throw new Error(`Expected a signed 32-bit integer for enum ${type}, got ${value}`)
          }
          writer.writeI32(num)
          return
        }
        if (ast.struct && ast.struct[type]) {
          writeStruct(writer, value, type, ast)
          return
        }
        if (ast.exception && ast.exception[type]) {
          writeStruct(writer, value, type, ast)
          return
        }
        if (ast.union && ast.union[type]) {
          writeUnion(writer, value, type, ast)
          return
        }
        throw new Error(`Unknown type: ${type}`)
      }
    }
  }

  switch (type.name) {
    case 'list':
    case 'set': {
      if (!Array.isArray(value)) throw new Error(`Expected array for ${type.name}, got ${typeof value}`)
      const elemTypeId = getTypeId(type.valueType, ast)
      writer.writeByte(elemTypeId)
      writer.writeI32(value.length)
      for (const item of value) {
        writeValue(writer, item, type.valueType, ast)
      }
      return
    }
    case 'map': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Expected object for map, got ${typeof value}`)
      }
      const entries = Object.entries(value)
      const keyTypeId = getTypeId(type.keyType, ast)
      const valTypeId = getTypeId(type.valueType, ast)
      writer.writeByte(keyTypeId)
      writer.writeByte(valTypeId)
      writer.writeI32(entries.length)
      for (const [k, v] of entries) {
        writeValue(writer, k, type.keyType, ast)
        writeValue(writer, v, type.valueType, ast)
      }
      return
    }
  }
}

function writeStruct(writer: ThriftBinaryWriter, value: unknown, structName: string, ast: ThriftAST) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected object for struct ${structName}, got ${typeof value}`)
  }

  const fields = ast.struct?.[structName] ?? ast.exception?.[structName]
  if (!fields) throw new Error(`Unknown struct or exception: ${structName}`)

  const obj = value as Record<string, unknown>
  const sortedFields = [...fields].sort((a, b) => a.id - b.id)

  for (const field of sortedFields) {
    const fieldValue = obj[field.name]
    if (fieldValue === undefined || fieldValue === null) {
      if (field.option === 'required') {
        throw new Error(`Missing required field: ${field.name} in struct ${structName}`)
      }
      continue
    }
    const typeId = getTypeId(field.type, ast)
    writer.writeByte(typeId)
    writer.writeI16(field.id)
    writeValue(writer, fieldValue, field.type, ast)
  }

  writer.writeByte(0) // STOP
}

function writeUnion(writer: ThriftBinaryWriter, value: unknown, unionName: string, ast: ThriftAST) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected object for union ${unionName}, got ${typeof value}`)
  }

  const fields = ast.union?.[unionName]
  if (!fields) throw new Error(`Unknown union: ${unionName}`)

  const obj = value as Record<string, unknown>
  let written = false

  for (const field of fields) {
    const fieldValue = obj[field.name]
    if (fieldValue !== undefined && fieldValue !== null) {
      if (written) {
        throw new Error(`Union ${unionName} must have only one field set, but multiple were provided`)
      }
      const typeId = getTypeId(field.type, ast)
      writer.writeByte(typeId)
      writer.writeI16(field.id)
      writeValue(writer, fieldValue, field.type, ast)
      written = true
    }
  }

  if (!written) {
    throw new Error(`Union ${unionName} must have exactly one field set`)
  }

  writer.writeByte(0) // STOP
}

/* ─── Public API ─── */

export function serializeThriftBinary(ast: ThriftAST, structName: string, data: unknown): Buffer {
  const writer = new ThriftBinaryWriter()
  if (ast.union?.[structName]) {
    writeUnion(writer, data, structName, ast)
  } else {
    writeStruct(writer, data, structName, ast)
  }
  return writer.finish()
}

/* ─── TBinaryProtocol reader ─── */

class ThriftBinaryReader {
  private offset = 0

  constructor(private readonly buffer: Buffer) {}

  private requireBytes(length: number): void {
    if (
      !Number.isInteger(length) ||
      length < 0 ||
      this.offset + length > this.buffer.length
    ) {
      throw new Error('Unexpected end of Thrift binary message')
    }
  }

  readByte(): number {
    this.requireBytes(1)
    return this.buffer.readUInt8(this.offset++)
  }

  readI8(): number {
    this.requireBytes(1)
    return this.buffer.readInt8(this.offset++)
  }

  readI16(): number {
    this.requireBytes(2)
    const value = this.buffer.readInt16BE(this.offset)
    this.offset += 2
    return value
  }

  readI32(): number {
    this.requireBytes(4)
    const value = this.buffer.readInt32BE(this.offset)
    this.offset += 4
    return value
  }

  readI64(): string {
    this.requireBytes(8)
    const value = this.buffer.readBigInt64BE(this.offset)
    this.offset += 8
    return value.toString()
  }

  readDouble(): number {
    this.requireBytes(8)
    const value = this.buffer.readDoubleBE(this.offset)
    this.offset += 8
    return value
  }

  readString(): string {
    const length = this.readI32()
    if (length < 0) {
      throw new Error(`Invalid Thrift binary string length: ${length}`)
    }
    this.requireBytes(length)
    const bytes = this.buffer.subarray(this.offset, this.offset + length)
    this.offset += length
    return bytes.toString('utf8')
  }

  get remaining(): number {
    return this.buffer.length - this.offset
  }
}

const MAX_THRIFT_COLLECTION_SIZE = 1_000_000
const MAX_THRIFT_DEPTH = 64

function assertWireType(actual: number, expected: ThriftType, ast: ThriftAST): void {
  const expectedId = getTypeId(expected, ast)
  if (actual !== expectedId) {
    throw new Error(`Thrift wire type mismatch: expected ${expectedId}, got ${actual}`)
  }
}

function readCollectionSize(reader: ThriftBinaryReader): number {
  const size = reader.readI32()
  if (size < 0 || size > MAX_THRIFT_COLLECTION_SIZE) {
    throw new Error(`Invalid Thrift collection size: ${size}`)
  }
  return size
}

function skipValue(reader: ThriftBinaryReader, fieldType: number, depth: number): void {
  if (depth > MAX_THRIFT_DEPTH) throw new Error('Thrift value exceeds maximum nesting depth')
  switch (fieldType) {
    case 2: // bool
    case 3: // byte/i8
      reader.readByte()
      return
    case 6: // i16
      reader.readI16()
      return
    case 8: // i32
      reader.readI32()
      return
    case 10: // i64
      reader.readI64()
      return
    case 4: // double
      reader.readDouble()
      return
    case 11: // string/binary
      reader.readString()
      return
    case 12: // struct
      skipStruct(reader, depth + 1)
      return
    case 13: { // map
      const keyType = reader.readByte()
      const valueType = reader.readByte()
      const size = readCollectionSize(reader)
      for (let index = 0; index < size; index += 1) {
        skipValue(reader, keyType, depth + 1)
        skipValue(reader, valueType, depth + 1)
      }
      return
    }
    case 14: // set
    case 15: { // list
      const itemType = reader.readByte()
      const size = readCollectionSize(reader)
      for (let index = 0; index < size; index += 1) {
        skipValue(reader, itemType, depth + 1)
      }
      return
    }
    default:
      throw new Error(`Unsupported Thrift wire type: ${fieldType}`)
  }
}

function readValue(
  reader: ThriftBinaryReader,
  type: ThriftType,
  ast: ThriftAST,
  depth: number,
): unknown {
  if (depth > MAX_THRIFT_DEPTH) throw new Error('Thrift value exceeds maximum nesting depth')
  if (typeof type === 'string') {
    if (ast.typedef && ast.typedef[type]) {
      return readValue(reader, ast.typedef[type].type, ast, depth + 1)
    }
    switch (type) {
      case 'bool':
        return reader.readByte() !== 0
      case 'byte':
      case 'i8':
        return reader.readI8()
      case 'i16':
        return reader.readI16()
      case 'int':
      case 'i32':
        return reader.readI32()
      case 'i64':
        return reader.readI64()
      case 'double':
        return reader.readDouble()
      case 'string':
        return reader.readString()
      case 'binary':
        return reader.readString() // TODO: return base64?
      default: {
        const enumInfo = ast.enum?.[type]
        if (enumInfo) {
          const value = reader.readI32()
          return enumInfo.items.find((item) => item.value === value)?.name ?? value
        }
        if (ast.struct?.[type] || ast.exception?.[type]) {
          return readStruct(reader, type, ast, depth + 1)
        }
        if (ast.union?.[type]) {
          return readStruct(reader, type, ast, depth + 1)
        }
        throw new Error(`Unknown type: ${type}`)
      }
    }
  }

  switch (type.name) {
    case 'list':
    case 'set': {
      const wireType = reader.readByte()
      assertWireType(wireType, type.valueType, ast)
      const length = readCollectionSize(reader)
      return Array.from({ length }, () => readValue(reader, type.valueType, ast, depth + 1))
    }
    case 'map': {
      const keyWireType = reader.readByte()
      const valueWireType = reader.readByte()
      assertWireType(keyWireType, type.keyType, ast)
      assertWireType(valueWireType, type.valueType, ast)
      const size = readCollectionSize(reader)
      const result: Record<string, unknown> = Object.create(null)
      for (let index = 0; index < size; index += 1) {
        const key = readValue(reader, type.keyType, ast, depth + 1)
        result[String(key)] = readValue(reader, type.valueType, ast, depth + 1)
      }
      return result
    }
  }
}

function skipStruct(reader: ThriftBinaryReader, depth: number): void {
  while (true) {
    const wireType = reader.readByte()
    if (wireType === 0) return
    reader.readI16()
    skipValue(reader, wireType, depth + 1)
  }
}

function readStruct(
  reader: ThriftBinaryReader,
  structName: string,
  ast: ThriftAST,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_THRIFT_DEPTH) throw new Error('Thrift value exceeds maximum nesting depth')
  const fields =
    ast.struct?.[structName] ??
    ast.exception?.[structName] ??
    ast.union?.[structName]
  if (!fields) throw new Error(`Unknown Thrift struct, exception, or union: ${structName}`)
  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  const result: Record<string, unknown> = {}

  while (true) {
    const wireType = reader.readByte()
    if (wireType === 0) return result
    const fieldId = reader.readI16()
    const field = fieldsById.get(fieldId)
    if (!field) {
      skipValue(reader, wireType, depth + 1)
      continue
    }
    assertWireType(wireType, field.type, ast)
    result[field.name] = readValue(reader, field.type, ast, depth + 1)
  }
}

export function decodeThriftBinary(
  ast: ThriftAST,
  structName: string,
  buffer: Buffer,
): Record<string, unknown> {
  const reader = new ThriftBinaryReader(buffer)
  const result = readStruct(reader, structName, ast, 0)
  if (reader.remaining !== 0) {
    throw new Error(`Thrift binary message has ${reader.remaining} trailing byte(s)`)
  }
  return result
}

/* ─── TCompactProtocol reader / writer helpers ─── */

class ThriftCompactReader {
  private offset = 0

  constructor(private readonly buffer: Buffer) {}

  private requireBytes(length: number): void {
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.buffer.length) {
      throw new Error('Unexpected end of Thrift compact message')
    }
  }

  readByte(): number {
    this.requireBytes(1)
    return this.buffer.readUInt8(this.offset++)
  }

  readDouble(): number {
    this.requireBytes(8)
    const value = this.buffer.readDoubleLE(this.offset)
    this.offset += 8
    return value
  }

  readVarint(maxBytes: number): bigint {
    let value = 0n
    for (let index = 0; index < maxBytes; index += 1) {
      const byte = this.readByte()
      value |= BigInt(byte & 0x7f) << BigInt(index * 7)
      if ((byte & 0x80) === 0) return value
    }
    throw new Error('Invalid Thrift compact varint')
  }

  readSignedVarint(maxBytes: number): bigint {
    const value = this.readVarint(maxBytes)
    return (value >> 1n) ^ -(value & 1n)
  }

  readI16(): number {
    const value = this.readSignedVarint(3)
    if (value < -32768n || value > 32767n) {
      throw new Error(`Thrift compact i16 is out of range: ${value}`)
    }
    return Number(value)
  }

  readI32(): number {
    const value = this.readSignedVarint(5)
    if (value < -2147483648n || value > 2147483647n) {
      throw new Error(`Thrift compact i32 is out of range: ${value}`)
    }
    return Number(value)
  }

  readI64(): string {
    return this.readSignedVarint(10).toString()
  }

  readBool(): boolean {
    const value = this.readByte()
    if (value !== COMPACT_TRUE && value !== COMPACT_FALSE) {
      throw new Error(`Invalid Thrift compact boolean: ${value}`)
    }
    return value === COMPACT_TRUE
  }

  readString(binary: boolean): string {
    const length = this.readVarint(5)
    if (length > BigInt(MAX_THRIFT_COLLECTION_SIZE)) {
      throw new Error(`Invalid Thrift compact string size: ${length}`)
    }
    const size = Number(length)
    this.requireBytes(size)
    const bytes = this.buffer.subarray(this.offset, this.offset + size)
    this.offset += size
    return binary ? bytes.toString('base64') : bytes.toString('utf8')
  }

  get remaining(): number {
    return this.buffer.length - this.offset
  }
}

const COMPACT_TRUE = 1
const COMPACT_FALSE = 2

function getCompactTypeId(type: ThriftType, ast: ThriftAST): number {
  if (typeof type === 'string') {
    if (ast.typedef?.[type]) return getCompactTypeId(ast.typedef[type].type, ast)
    switch (type) {
      case 'bool':
        return COMPACT_TRUE
      case 'byte':
      case 'i8':
        return 3
      case 'i16':
        return 4
      case 'int':
      case 'i32':
        return 5
      case 'i64':
        return 6
      case 'double':
        return 7
      case 'string':
      case 'binary':
        return 8
      default:
        if (ast.enum?.[type]) return 5
        if (ast.struct?.[type] || ast.exception?.[type] || ast.union?.[type]) return 12
        throw new Error(`Unknown type: ${type}`)
    }
  }
  switch (type.name) {
    case 'list':
      return 9
    case 'set':
      return 10
    case 'map':
      return 11
  }
}

function isCompactBoolType(type: ThriftType, ast: ThriftAST): boolean {
  if (typeof type !== 'string') return false
  if (type === 'bool') return true
  const typedef = ast.typedef?.[type]
  return typedef ? isCompactBoolType(typedef.type, ast) : false
}

function assertCompactType(actual: number, expected: ThriftType, ast: ThriftAST): void {
  const expectedId = getCompactTypeId(expected, ast)
  if (
    actual !== expectedId &&
    !(isCompactBoolType(expected, ast) && actual === COMPACT_FALSE)
  ) {
    throw new Error(`Thrift compact type mismatch: expected ${expectedId}, got ${actual}`)
  }
}

function readCompactCollectionSize(reader: ThriftCompactReader): number {
  const size = reader.readVarint(5)
  if (size > BigInt(MAX_THRIFT_COLLECTION_SIZE)) {
    throw new Error(`Invalid Thrift compact collection size: ${size}`)
  }
  return Number(size)
}

function readCompactFieldHeader(
  reader: ThriftCompactReader,
  previousFieldId: number,
): { fieldId: number; type: number } {
  const header = reader.readByte()
  const type = header & 0x0f
  if (type === 0) return { fieldId: 0, type: 0 }

  const delta = header >>> 4
  const fieldId = delta === 0 ? previousFieldId + reader.readI16() : previousFieldId + delta
  if (fieldId < -32768 || fieldId > 32767) {
    throw new Error(`Invalid Thrift compact field id: ${fieldId}`)
  }
  return { fieldId, type }
}

function skipCompactValue(
  reader: ThriftCompactReader,
  type: number,
  depth: number,
): void {
  if (depth > MAX_THRIFT_DEPTH) throw new Error('Thrift value exceeds maximum nesting depth')
  switch (type) {
    case COMPACT_TRUE:
    case COMPACT_FALSE:
    case 3:
      reader.readByte()
      return
    case 4:
      reader.readI16()
      return
    case 5:
      reader.readI32()
      return
    case 6:
      reader.readI64()
      return
    case 7:
      reader.readDouble()
      return
    case 8:
      reader.readString(true)
      return
    case 9:
    case 10: {
      const header = reader.readByte()
      const sizeNibble = header >>> 4
      const size = sizeNibble === 15 ? readCompactCollectionSize(reader) : sizeNibble
      const itemType = header & 0x0f
      for (let index = 0; index < size; index += 1) {
        skipCompactValue(reader, itemType, depth + 1)
      }
      return
    }
    case 11: {
      const size = readCompactCollectionSize(reader)
      if (size === 0) return
      const types = reader.readByte()
      const keyType = types >>> 4
      const valueType = types & 0x0f
      for (let index = 0; index < size; index += 1) {
        skipCompactValue(reader, keyType, depth + 1)
        skipCompactValue(reader, valueType, depth + 1)
      }
      return
    }
    case 12:
      skipCompactStruct(reader, depth + 1)
      return
    default:
      throw new Error(`Unsupported Thrift compact type: ${type}`)
  }
}

function readCompactValue(
  reader: ThriftCompactReader,
  type: ThriftType,
  ast: ThriftAST,
  depth: number,
  fieldBool?: boolean,
): unknown {
  if (depth > MAX_THRIFT_DEPTH) throw new Error('Thrift value exceeds maximum nesting depth')
  if (typeof type === 'string') {
    if (ast.typedef?.[type]) {
      return readCompactValue(reader, ast.typedef[type].type, ast, depth + 1, fieldBool)
    }
    switch (type) {
      case 'bool':
        return fieldBool ?? reader.readBool()
      case 'byte':
      case 'i8':
        return reader.readByte() << 24 >> 24
      case 'i16':
        return reader.readI16()
      case 'int':
      case 'i32':
        return reader.readI32()
      case 'i64':
        return reader.readI64()
      case 'double':
        return reader.readDouble()
      case 'string':
        return reader.readString(false)
      case 'binary':
        return reader.readString(true)
      default: {
        const enumInfo = ast.enum?.[type]
        if (enumInfo) {
          const value = reader.readI32()
          return enumInfo.items.find((item) => item.value === value)?.name ?? value
        }
        if (ast.struct?.[type] || ast.exception?.[type] || ast.union?.[type]) {
          return readCompactStruct(reader, type, ast, depth + 1)
        }
        throw new Error(`Unknown type: ${type}`)
      }
    }
  }

  switch (type.name) {
    case 'list':
    case 'set': {
      const header = reader.readByte()
      const sizeNibble = header >>> 4
      const size = sizeNibble === 15 ? readCompactCollectionSize(reader) : sizeNibble
      const itemType = header & 0x0f
      assertCompactType(itemType, type.valueType, ast)
      return Array.from({ length: size }, () =>
        readCompactValue(reader, type.valueType, ast, depth + 1),
      )
    }
    case 'map': {
      const size = readCompactCollectionSize(reader)
      if (size === 0) return {}
      const types = reader.readByte()
      const keyType = types >>> 4
      const valueType = types & 0x0f
      assertCompactType(keyType, type.keyType, ast)
      assertCompactType(valueType, type.valueType, ast)
      const result: Record<string, unknown> = Object.create(null)
      for (let index = 0; index < size; index += 1) {
        const key = readCompactValue(reader, type.keyType, ast, depth + 1)
        result[String(key)] = readCompactValue(reader, type.valueType, ast, depth + 1)
      }
      return result
    }
  }
}

function skipCompactStruct(reader: ThriftCompactReader, depth: number): void {
  let previousFieldId = 0
  while (true) {
    const { fieldId, type } = readCompactFieldHeader(reader, previousFieldId)
    if (type === 0) return
    previousFieldId = fieldId
    if (type !== COMPACT_TRUE && type !== COMPACT_FALSE) {
      skipCompactValue(reader, type, depth + 1)
    }
  }
}

function readCompactStruct(
  reader: ThriftCompactReader,
  structName: string,
  ast: ThriftAST,
  depth: number,
): Record<string, unknown> {
  if (depth > MAX_THRIFT_DEPTH) throw new Error('Thrift value exceeds maximum nesting depth')
  const fields =
    ast.struct?.[structName] ??
    ast.exception?.[structName] ??
    ast.union?.[structName]
  if (!fields) throw new Error(`Unknown Thrift struct, exception, or union: ${structName}`)
  const fieldsById = new Map(fields.map((field) => [field.id, field]))
  const result: Record<string, unknown> = {}
  let previousFieldId = 0

  while (true) {
    const { fieldId, type: compactType } = readCompactFieldHeader(reader, previousFieldId)
    if (compactType === 0) return result
    previousFieldId = fieldId
    const field = fieldsById.get(fieldId)
    if (!field) {
      if (compactType !== COMPACT_TRUE && compactType !== COMPACT_FALSE) {
        skipCompactValue(reader, compactType, depth + 1)
      }
      continue
    }
    assertCompactType(compactType, field.type, ast)
    const boolValue =
      isCompactBoolType(field.type, ast) &&
      (compactType === COMPACT_TRUE || compactType === COMPACT_FALSE)
        ? compactType === COMPACT_TRUE
        : undefined
    result[field.name] = readCompactValue(reader, field.type, ast, depth + 1, boolValue)
  }
}

export function decodeThriftCompact(
  ast: ThriftAST,
  structName: string,
  buffer: Buffer,
): Record<string, unknown> {
  const reader = new ThriftCompactReader(buffer)
  const result = readCompactStruct(reader, structName, ast, 0)
  if (reader.remaining !== 0) {
    throw new Error(`Thrift compact message has ${reader.remaining} trailing byte(s)`)
  }
  return result
}

/* ─── TCompactProtocol writer ─── */

class ThriftCompactWriter {
  private chunks: Buffer[] = []
  private length = 0

  writeByte(v: number) {
    const buf = Buffer.allocUnsafe(1)
    buf.writeUInt8(v & 0xff, 0)
    this.chunks.push(buf)
    this.length += 1
  }

  writeVarint(value: bigint, maxBytes: number) {
    const bytes: number[] = []
    let remaining = value
    while (true) {
      const byte = Number(remaining & 0x7fn)
      remaining >>= 7n
      if (remaining === 0n) {
        bytes.push(byte)
        break
      }
      bytes.push(byte | 0x80)
    }
    if (bytes.length > maxBytes) {
      throw new Error(`Varint exceeds maximum length of ${maxBytes} bytes`)
    }
    const buf = Buffer.from(bytes)
    this.chunks.push(buf)
    this.length += bytes.length
  }

  writeSignedVarint(value: bigint, maxBytes: number) {
    const encoded = (value << 1n) ^ (value >> 63n)
    this.writeVarint(encoded, maxBytes)
  }

  writeI16(v: number) {
    this.writeSignedVarint(BigInt(v), 3)
  }

  writeI32(v: number) {
    this.writeSignedVarint(BigInt(v), 5)
  }

  writeI64(v: bigint | number) {
    this.writeSignedVarint(typeof v === 'bigint' ? v : BigInt(v), 10)
  }

  writeDouble(v: number) {
    const buf = Buffer.allocUnsafe(8)
    buf.writeDoubleLE(v, 0)
    this.chunks.push(buf)
    this.length += 8
  }

  writeString(v: string) {
    const bytes = Buffer.from(v, 'utf8')
    this.writeVarint(BigInt(bytes.length), 5)
    this.chunks.push(bytes)
    this.length += bytes.length
  }

  finish(): Buffer {
    return Buffer.concat(this.chunks, this.length)
  }
}

function writeCompactValue(
  writer: ThriftCompactWriter,
  value: unknown,
  type: ThriftType,
  ast: ThriftAST,
) {
  if (typeof type === 'string') {
    if (ast.typedef && ast.typedef[type]) {
      writeCompactValue(writer, value, ast.typedef[type].type, ast)
      return
    }

    switch (type) {
      case 'bool': {
        if (typeof value !== 'boolean') throw new Error(`Expected boolean, got ${typeof value}`)
        writer.writeByte(value ? COMPACT_TRUE : COMPACT_FALSE)
        return
      }
      case 'byte':
      case 'i8': {
        const num = numberValue(value, type)
        if (!Number.isInteger(num) || num < -128 || num > 127) {
          throw new Error(`Expected a signed 8-bit integer for ${type}, got ${value}`)
        }
        writer.writeByte(num)
        return
      }
      case 'i16': {
        const num = numberValue(value, type)
        if (!Number.isInteger(num) || num < -32768 || num > 32767) {
          throw new Error(`Expected a signed 16-bit integer, got ${value}`)
        }
        writer.writeI16(num)
        return
      }
      case 'int':
      case 'i32': {
        const num = numberValue(value, type)
        if (!Number.isInteger(num) || num < -2147483648 || num > 2147483647) {
          throw new Error(`Expected a signed 32-bit integer, got ${value}`)
        }
        writer.writeI32(num)
        return
      }
      case 'i64': {
        if (typeof value === 'bigint') {
          writer.writeI64(value)
        } else if (typeof value === 'number') {
          if (!Number.isSafeInteger(value)) {
            throw new Error(`Expected a safe integer or decimal string for i64, got ${value}`)
          }
          writer.writeI64(value)
        } else if (typeof value === 'string') {
          if (!/^[+-]?\d+$/.test(value)) {
            throw new Error(`Expected a decimal integer string for i64, got ${value}`)
          }
          writer.writeI64(BigInt(value))
        } else {
          throw new Error(`Expected bigint/number/string for i64, got ${typeof value}`)
        }
        return
      }
      case 'double': {
        const num = numberValue(value, type)
        writer.writeDouble(num)
        return
      }
      case 'string':
      case 'binary': {
        if (typeof value !== 'string') throw new Error(`Expected string, got ${typeof value}`)
        writer.writeString(value)
        return
      }
      default: {
        if (ast.enum && ast.enum[type]) {
          const enumItem =
            typeof value === 'string'
              ? ast.enum[type].items.find((item) => item.name === value)
              : undefined
          const num = enumItem?.value ?? numberValue(value, `enum ${type}`)
          if (!Number.isInteger(num) || num < -2147483648 || num > 2147483647) {
            throw new Error(`Expected a signed 32-bit integer for enum ${type}, got ${value}`)
          }
          writer.writeI32(num)
          return
        }
        if (ast.struct && ast.struct[type]) {
          writeCompactStruct(writer, value, type, ast)
          return
        }
        if (ast.exception && ast.exception[type]) {
          writeCompactStruct(writer, value, type, ast)
          return
        }
        if (ast.union && ast.union[type]) {
          writeCompactUnion(writer, value, type, ast)
          return
        }
        throw new Error(`Unknown type: ${type}`)
      }
    }
  }

  switch (type.name) {
    case 'list':
    case 'set': {
      if (!Array.isArray(value)) throw new Error(`Expected array for ${type.name}, got ${typeof value}`)
      const itemTypeId = getCompactTypeId(type.valueType, ast)
      if (value.length < 15) {
        writer.writeByte((value.length << 4) | itemTypeId)
      } else {
        writer.writeByte((15 << 4) | itemTypeId)
        writer.writeVarint(BigInt(value.length), 5)
      }
      for (const item of value) {
        writeCompactValue(writer, item, type.valueType, ast)
      }
      return
    }
    case 'map': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Expected object for map, got ${typeof value}`)
      }
      const entries = Object.entries(value)
      writer.writeVarint(BigInt(entries.length), 5)
      if (entries.length === 0) return
      const keyTypeId = getCompactTypeId(type.keyType, ast)
      const valTypeId = getCompactTypeId(type.valueType, ast)
      writer.writeByte((keyTypeId << 4) | valTypeId)
      for (const [k, v] of entries) {
        writeCompactValue(writer, k, type.keyType, ast)
        writeCompactValue(writer, v, type.valueType, ast)
      }
      return
    }
  }
}

function writeCompactStruct(
  writer: ThriftCompactWriter,
  value: unknown,
  structName: string,
  ast: ThriftAST,
) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected object for struct ${structName}, got ${typeof value}`)
  }

  const fields = ast.struct?.[structName] ?? ast.exception?.[structName]
  if (!fields) throw new Error(`Unknown struct or exception: ${structName}`)

  const obj = value as Record<string, unknown>
  const sortedFields = [...fields].sort((a, b) => a.id - b.id)

  let previousFieldId = 0
  for (const field of sortedFields) {
    const fieldValue = obj[field.name]
    if (fieldValue === undefined || fieldValue === null) {
      if (field.option === 'required') {
        throw new Error(`Missing required field: ${field.name} in struct ${structName}`)
      }
      continue
    }

    const typeId = getCompactTypeId(field.type, ast)
    const delta = field.id - previousFieldId

    if (isCompactBoolType(field.type, ast)) {
      if (typeof fieldValue !== 'boolean') {
        throw new Error(`Expected boolean for field ${field.name}, got ${typeof fieldValue}`)
      }
      const boolType = fieldValue ? COMPACT_TRUE : COMPACT_FALSE
      if (delta >= 1 && delta <= 15) {
        writer.writeByte((delta << 4) | boolType)
      } else {
        writer.writeByte(boolType)
        writer.writeSignedVarint(BigInt(delta), 3)
      }
    } else {
      if (delta >= 1 && delta <= 15) {
        writer.writeByte((delta << 4) | typeId)
      } else {
        writer.writeByte(typeId)
        writer.writeSignedVarint(BigInt(delta), 3)
      }
      writeCompactValue(writer, fieldValue, field.type, ast)
    }

    previousFieldId = field.id
  }

  writer.writeByte(0) // STOP
}

function writeCompactUnion(
  writer: ThriftCompactWriter,
  value: unknown,
  unionName: string,
  ast: ThriftAST,
) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Expected object for union ${unionName}, got ${typeof value}`)
  }

  const fields = ast.union?.[unionName]
  if (!fields) throw new Error(`Unknown union: ${unionName}`)

  const obj = value as Record<string, unknown>
  let written = false
  let previousFieldId = 0

  for (const field of fields) {
    const fieldValue = obj[field.name]
    if (fieldValue !== undefined && fieldValue !== null) {
      if (written) {
        throw new Error(`Union ${unionName} must have only one field set, but multiple were provided`)
      }
      const typeId = getCompactTypeId(field.type, ast)
      const delta = field.id - previousFieldId

      if (isCompactBoolType(field.type, ast)) {
        if (typeof fieldValue !== 'boolean') {
          throw new Error(`Expected boolean for field ${field.name}, got ${typeof fieldValue}`)
        }
        const boolType = fieldValue ? COMPACT_TRUE : COMPACT_FALSE
        if (delta >= 1 && delta <= 15) {
          writer.writeByte((delta << 4) | boolType)
        } else {
          writer.writeByte(boolType)
          writer.writeSignedVarint(BigInt(delta), 3)
        }
      } else {
        if (delta >= 1 && delta <= 15) {
          writer.writeByte((delta << 4) | typeId)
        } else {
          writer.writeByte(typeId)
          writer.writeSignedVarint(BigInt(delta), 3)
        }
        writeCompactValue(writer, fieldValue, field.type, ast)
      }

      written = true
      previousFieldId = field.id
    }
  }

  if (!written) {
    throw new Error(`Union ${unionName} must have exactly one field set`)
  }

  writer.writeByte(0) // STOP
}

export function serializeThriftCompact(ast: ThriftAST, structName: string, data: unknown): Buffer {
  const writer = new ThriftCompactWriter()
  if (ast.union?.[structName]) {
    writeCompactUnion(writer, data, structName, ast)
  } else {
    writeCompactStruct(writer, data, structName, ast)
  }
  return writer.finish()
}

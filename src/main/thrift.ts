/**
 * Lightweight Thrift IDL parser + TBinaryProtocol serializer for the
 * Electron main process.  Uses the `thrift-parser` package to turn a
 * raw IDL string into an AST, then encodes a plain JSON object into
 * a Thrift binary payload.
 *
 * Supported types:
 *   bool, byte/i8, i16, i32, i64, double, string, binary,
 *   list<T>, set<T>, map<K,V>, struct, exception, union, enum, typedef.
 */

import { createRequire } from 'node:module'
const thriftRequire = createRequire(__filename)
const thriftParser = thriftRequire('thrift-parser')

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
  const names: string[] = []
  if (ast.struct) names.push(...Object.keys(ast.struct))
  if (ast.exception) names.push(...Object.keys(ast.exception))
  if (ast.union) names.push(...Object.keys(ast.union))
  return names.sort((a, b) => a.localeCompare(b))
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

/* ─── Type mapping ─── */

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
      if (!Array.isArray(value))
        throw new Error(`Expected array for ${type.name}, got ${typeof value}`)
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
      const keyTypeId = getTypeId(type.keyType, ast)
      const valTypeId = getTypeId(type.valueType, ast)
      writer.writeByte(keyTypeId)
      writer.writeByte(valTypeId)
      const entries = Object.entries(value)
      writer.writeI32(entries.length)
      for (const [k, v] of entries) {
        writeValue(writer, k, type.keyType, ast)
        writeValue(writer, v, type.valueType, ast)
      }
      return
    }
    default:
      throw new Error(`Unsupported container type: ${(type as any).name}`)
  }
}

/* ─── Struct / Union ─── */

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
    if (!Number.isInteger(length) || length < 0 || this.offset + length > this.buffer.length) {
      throw new Error('Unexpected end of Thrift message')
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
    const value = this.buffer.readBigInt64BE(this.offset).toString()
    this.offset += 8
    return value
  }

  readDouble(): number {
    this.requireBytes(8)
    const value = this.buffer.readDoubleBE(this.offset)
    this.offset += 8
    return value
  }

  readString(binary: boolean): string {
    const length = this.readI32()
    this.requireBytes(length)
    const bytes = this.buffer.subarray(this.offset, this.offset + length)
    this.offset += length
    return binary ? bytes.toString('base64') : bytes.toString('utf8')
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
    throw new Error(`Thrift type mismatch: expected wire type ${expectedId}, got ${actual}`)
  }
}

function readCollectionSize(reader: ThriftBinaryReader): number {
  const size = reader.readI32()
  if (size < 0 || size > MAX_THRIFT_COLLECTION_SIZE) {
    throw new Error(`Invalid Thrift collection size: ${size}`)
  }
  return size
}

function skipValue(reader: ThriftBinaryReader, wireType: number, depth: number): void {
  if (depth > MAX_THRIFT_DEPTH) throw new Error('Thrift value exceeds maximum nesting depth')

  switch (wireType) {
    case 2:
    case 3:
      reader.readByte()
      return
    case 4:
      reader.readDouble()
      return
    case 6:
      reader.readI16()
      return
    case 8:
      reader.readI32()
      return
    case 10:
      reader.readI64()
      return
    case 11:
      reader.readString(true)
      return
    case 12:
      while (true) {
        const fieldType = reader.readByte()
        if (fieldType === 0) return
        reader.readI16()
        skipValue(reader, fieldType, depth + 1)
      }
    case 13: {
      const keyType = reader.readByte()
      const valueType = reader.readByte()
      const size = readCollectionSize(reader)
      for (let index = 0; index < size; index += 1) {
        skipValue(reader, keyType, depth + 1)
        skipValue(reader, valueType, depth + 1)
      }
      return
    }
    case 14:
    case 15: {
      const itemType = reader.readByte()
      const size = readCollectionSize(reader)
      for (let index = 0; index < size; index += 1) {
        skipValue(reader, itemType, depth + 1)
      }
      return
    }
    default:
      throw new Error(`Unsupported Thrift wire type: ${wireType}`)
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
    if (ast.typedef?.[type]) return readValue(reader, ast.typedef[type].type, ast, depth + 1)
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
      const size = readCollectionSize(reader)
      return Array.from({ length: size }, () =>
        readValue(reader, type.valueType, ast, depth + 1),
      )
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
    throw new Error(`Thrift message has ${reader.remaining} trailing byte(s)`)
  }
  return result
}

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

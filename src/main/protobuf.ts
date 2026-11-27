import * as protobuf from 'protobufjs'

export function parseProtobufProto(proto: string): { names: string[]; error?: string } {
  try {
    const parsed = protobuf.parse(proto)
    const names: string[] = []
    function collect(ns: protobuf.NamespaceBase) {
      for (const nested of ns.nestedArray ?? []) {
        if (nested instanceof protobuf.Type) {
          names.push(nested.fullName.replace(/^\./, ''))
        }
        if (nested instanceof protobuf.Namespace) {
          collect(nested)
        }
      }
    }
    collect(parsed.root)
    return { names: names.sort() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { names: [], error: msg }
  }
}

export function serializeProtobuf(proto: string, messageName: string, data: unknown): Buffer {
  const parsed = protobuf.parse(proto)
  const type = parsed.root.lookupType(messageName)
  const err = type.verify(data)
  if (err) throw new Error(err)
  return type.encode(data as protobuf.Message<object>).finish() as Buffer
}

export function decodeProtobuf(proto: string, messageName: string, buffer: Buffer): unknown {
  const parsed = protobuf.parse(proto)
  const type = parsed.root.lookupType(messageName)
  return type.decode(buffer).toJSON()
}

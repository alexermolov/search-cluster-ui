declare module 'protobufjs' {
  export class Type extends NamespaceBase {
    fullName: string
    verify(object: unknown): string | null
    encode(message: Message<object>): Writer
    decode(buffer: Uint8Array | Reader): Message<object>
    toJSON(): Record<string, unknown>
  }

  export class Message<T = object> {
    constructor(properties?: T)
    toJSON(): object
  }

  export class NamespaceBase {
    nestedArray: NamespaceBase[]
    fullName: string
    lookupType(name: string): Type
  }

  export class Namespace extends NamespaceBase {}

  export class Writer {
    finish(): Buffer
  }

  export interface Reader {
    // minimal interface; actual usage is Type.decode(buffer)
  }

  export interface IParserResult {
    root: NamespaceBase
  }

  export function parse(source: string, options?: unknown): IParserResult
}

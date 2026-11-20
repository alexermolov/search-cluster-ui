const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

function randString(len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) {
    s += ALPHANUM[Math.floor(Math.random() * ALPHANUM.length)]
  }
  return s
}

function randHex(len: number): string {
  let s = ''
  for (let i = 0; i < len; i++) {
    s += Math.floor(Math.random() * 16).toString(16)
  }
  return s
}

const FIRST_NAMES = [
  'Alice', 'Bob', 'Charlie', 'Diana', 'Evan', 'Fiona', 'George', 'Hannah',
  'Ian', 'Julia', 'Kevin', 'Liam', 'Mia', 'Noah', 'Olivia', 'Paul', 'Quinn',
  'Rachel', 'Sam', 'Tina', 'Ursula', 'Victor', 'Wendy', 'Xander', 'Yara', 'Zack',
]

const LAST_NAMES = [
  'Smith', 'Jones', 'Brown', 'Taylor', 'Anderson', 'Thomas', 'Jackson',
  'White', 'Harris', 'Martin', 'Thompson', 'Garcia', 'Martinez', 'Robinson', 'Clark',
]

function randName(): string {
  const f = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
  const l = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
  return `${f} ${l}`
}

function randEmail(): string {
  const user = randString(8).toLowerCase()
  const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'example.com', 'mail.com']
  const d = domains[Math.floor(Math.random() * domains.length)]
  return `${user}@${d}`
}

function parseArgs(argsStr: string | undefined): (string | number | boolean | null)[] {
  if (!argsStr || argsStr.trim() === '') return []
  const out: (string | number | boolean | null)[] = []
  let current = ''
  let inQuotes: false | '"' | "'" = false
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i]
    if (!inQuotes && (ch === '"' || ch === "'")) {
      inQuotes = ch
      continue
    }
    if (inQuotes && ch === inQuotes) {
      inQuotes = false
      continue
    }
    if (!inQuotes && ch === ',') {
      out.push(parseArg(current))
      current = ''
      continue
    }
    current += ch
  }
  out.push(parseArg(current))
  return out
}

function parseArg(t: string): string | number | boolean | null {
  const trimmed = t.trim()
  if (trimmed === 'true') return true
  if (trimmed === 'false') return false
  if (trimmed === 'null') return null
  if (trimmed === '') return ''
  const n = Number(trimmed)
  if (!Number.isNaN(n) && trimmed !== '') return n
  return trimmed
}

type TemplateResult = string | number | boolean | null | unknown[] | Record<string, unknown>

function evalExpr(expr: string, index: number): TemplateResult {
  const match = expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?:\((.*)\))?$/)
  if (!match) return '${' + expr + '}'
  const [, name, argsRaw] = match
  const args = argsRaw !== undefined ? parseArgs(argsRaw) : []

  switch (name) {
    case 'i':
      return index
    case 'uuid':
      return uuidv4()
    case 'randInt': {
      const min = args.length > 0 ? Number(args[0]) : 0
      const max = args.length > 1 ? Number(args[1]) : 100
      const lo = Math.min(min, max)
      const hi = Math.max(min, max)
      return Math.floor(Math.random() * (hi - lo + 1)) + lo
    }
    case 'randFloat': {
      const min = args.length > 0 ? Number(args[0]) : 0
      const max = args.length > 1 ? Number(args[1]) : 1
      const lo = Math.min(min, max)
      const hi = Math.max(min, max)
      return Math.random() * (hi - lo) + lo
    }
    case 'randBool':
      return Math.random() < 0.5
    case 'randString': {
      const len = args.length > 0 ? Number(args[0]) : 10
      return randString(Math.max(0, Math.floor(len)))
    }
    case 'randHex': {
      const len = args.length > 0 ? Number(args[0]) : 8
      return randHex(Math.max(0, Math.floor(len)))
    }
    case 'randEmail':
      return randEmail()
    case 'randName':
      return randName()
    case 'now':
      return Date.now()
    case 'nowIso':
      return new Date().toISOString()
    case 'pick': {
      if (args.length === 0) return ''
      return args[Math.floor(Math.random() * args.length)]
    }
    default:
      return '${' + expr + '}'
  }
}

export function applyTemplate(str: string, index: number): string {
  return str.replace(/\$\{([^}]+)\}/g, (_, expr) => String(evalExpr(expr.trim(), index)))
}

export function applyTemplateToValue(value: unknown, index: number): unknown {
  if (typeof value === 'string') {
    const fullMatch = value.match(/^\$\{([^}]+)\}$/)
    if (fullMatch) {
      const result = evalExpr(fullMatch[1].trim(), index)
      if (typeof result !== 'string') return result
      return result
    }
    return value.replace(/\$\{([^}]+)\}/g, (_, expr) => String(evalExpr(expr.trim(), index)))
  }
  if (Array.isArray(value)) {
    return value.map((v) => applyTemplateToValue(v, index))
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = applyTemplateToValue(v, index)
    }
    return out
  }
  return value
}

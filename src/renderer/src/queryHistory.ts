/**
 * Query history & snippets — renderer-side persistence in localStorage.
 * No IPC needed: this is pure UI-level state.
 */

export interface QueryHistoryEntry {
  id: string
  index: string
  body: string
  at: number
}

export interface QuerySnippet {
  id: string
  name: string
  index: string
  body: string
  createdAt: number
}

const HISTORY_KEY = 'queryHistory'
const SNIPPETS_KEY = 'querySnippets'
const MAX_HISTORY = 50

function readJson<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // localStorage unavailable (quota, disabled) — silently ignore
  }
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  }
}

export function loadHistory(): QueryHistoryEntry[] {
  return readJson<QueryHistoryEntry>(HISTORY_KEY).slice(0, MAX_HISTORY)
}

export function pushHistory(entry: Omit<QueryHistoryEntry, 'id' | 'at'>): QueryHistoryEntry[] {
  const list = readJson<QueryHistoryEntry>(HISTORY_KEY)
  const last = list[0]
  // Skip if the most recent entry is exactly the same query
  if (last && last.index === entry.index && last.body === entry.body) {
    return list.slice(0, MAX_HISTORY)
  }
  const next: QueryHistoryEntry[] = [{ id: newId(), index: entry.index, body: entry.body, at: Date.now() }, ...list]
  const trimmed = next.slice(0, MAX_HISTORY)
  writeJson(HISTORY_KEY, trimmed)
  return trimmed
}

export function removeHistoryEntry(id: string): QueryHistoryEntry[] {
  const next = readJson<QueryHistoryEntry>(HISTORY_KEY).filter((e) => e.id !== id)
  writeJson(HISTORY_KEY, next)
  return next
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    // ignore
  }
}

export function loadSnippets(): QuerySnippet[] {
  return readJson<QuerySnippet>(SNIPPETS_KEY)
}

export function saveSnippet(
  snippet: Omit<QuerySnippet, 'id' | 'createdAt'> & { id?: string },
): QuerySnippet[] {
  const list = readJson<QuerySnippet>(SNIPPETS_KEY)
  let next: QuerySnippet[]
  if (snippet.id != null) {
    const existing = list.find((s) => s.id === snippet.id)
    if (existing == null) return list
    next = list.map((s) =>
      s.id === snippet.id ? { ...s, name: snippet.name, index: snippet.index, body: snippet.body } : s,
    )
  } else {
    const created: QuerySnippet = {
      id: newId(),
      name: snippet.name,
      index: snippet.index,
      body: snippet.body,
      createdAt: Date.now(),
    }
    next = [created, ...list]
  }
  writeJson(SNIPPETS_KEY, next)
  return next
}

export function removeSnippet(id: string): QuerySnippet[] {
  const next = readJson<QuerySnippet>(SNIPPETS_KEY).filter((s) => s.id !== id)
  writeJson(SNIPPETS_KEY, next)
  return next
}

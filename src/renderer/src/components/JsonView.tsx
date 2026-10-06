// Lightweight JSON syntax highlighting for read-only output (no CodeMirror).

const TOKEN_RE =
  /"(?:[^"\\]|\\.)*"(?=\s*:)|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}[\],:]/g

/** Escape HTML special characters. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Token class for a matched JSON token (strings are classified by the caller). */
function tokenClass(token: string): string {
  if (token === 'true' || token === 'false') return 'tok-bool'
  if (token === 'null') return 'tok-null'
  if (/^-?\d/.test(token)) return 'tok-num'
  if (token.startsWith('"')) return 'tok-str'
  return 'tok-punct'
}

/**
 * Convert a JSON string into highlighted HTML.
 * Keys (string followed by a colon), strings, numbers, booleans, null
 * and punctuation are wrapped in spans; everything else is passed through.
 */
export function highlightJson(text: string): string {
  let out = ''
  let last = 0
  for (const m of text.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0
    out += escapeHtml(text.slice(last, idx))
    const token = m[0]
    // A string token followed by a colon is a key; the regex lookahead
    // already consumed that distinction, so check the raw match.
    const isKey = token.startsWith('"') && /^\s*:/.test(text.slice(idx + token.length))
    const cls = isKey ? 'tok-key' : tokenClass(token)
    out += `<span class="${cls}">${escapeHtml(token)}</span>`
    last = idx + token.length
  }
  out += escapeHtml(text.slice(last))
  return out
}

interface Props {
  value: unknown
}

/** Render JSON (object or pre-serialized string) with token colors. */
export function JsonView({ value }: Props) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return <span dangerouslySetInnerHTML={{ __html: highlightJson(text) }} />
}

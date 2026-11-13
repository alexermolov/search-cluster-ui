// Lightweight JSON syntax highlighting for read-only output (no CodeMirror).

const TOKEN_RE =
  /"(?:[^"\\]|\\.)*"(?=\s*:)|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}[\],:]/g;

/** Escape HTML special characters. */
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Token class for a matched JSON token (strings are classified by the caller). */
function tokenClass(token: string): string {
  if (token === "true" || token === "false") return "tok-bool";
  if (token === "null") return "tok-null";
  if (/^-?\d/.test(token)) return "tok-num";
  if (token.startsWith('"')) return "tok-str";
  return "tok-punct";
}

/**
 * Convert a JSON string into highlighted HTML.
 * Keys (string followed by a colon), strings, numbers, booleans, null
 * and punctuation are wrapped in spans; everything else is passed through.
 */
export function highlightJson(
  text: string,
  markers?: { open: string; close: string },
): string {
  let out = "";
  let last = 0;
  for (const m of text.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0;
    out += escapeHtml(text.slice(last, idx));
    const token = m[0];
    // A string token followed by a colon is a key; the regex lookahead
    // already consumed that distinction, so check the raw match.
    const isKey =
      token.startsWith('"') && /^\s*:/.test(text.slice(idx + token.length));
    const cls = isKey ? "tok-key" : tokenClass(token);
    let html = escapeHtml(token);
    if (markers != null) {
      html = html
        .split(markers.open)
        .join('<mark class="json-highlight">')
        .split(markers.close)
        .join("</mark>");
    }
    out += `<span class="${cls}">${html}</span>`;
    last = idx + token.length;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

interface Props {
  value: unknown;
  highlights?: Record<string, string[]>;
  onQuickQuery?: (field: string, value: string | number | boolean) => void;
}

interface JsonLineQuery {
  field: string;
  value: string | number | boolean;
}

function getLineQueries(
  text: string,
  excludedRootKey?: string,
): Array<JsonLineQuery | null> {
  const contexts: Array<{ path: string[] }> = [];
  return text.split("\n").map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return null;

    if (trimmed.startsWith("}") || trimmed.startsWith("]")) {
      contexts.pop();
      return null;
    }

    const property = trimmed.match(/^("(?:[^"\\]|\\.)*")\s*:\s*(.*)$/);
    let path: string[];
    let rawValue: string;

    if (property) {
      const key: unknown = JSON.parse(property[1]);
      if (typeof key !== "string") return null;
      const parentPath = contexts[contexts.length - 1]?.path ?? [];
      path = [...parentPath, key];
      rawValue = property[2];
    } else {
      path = contexts[contexts.length - 1]?.path ?? [];
      rawValue = trimmed;
    }

    rawValue = rawValue.replace(/,\s*$/, "");
    if (
      rawValue === "{" ||
      rawValue === "[" ||
      (rawValue.startsWith("{") && rawValue !== "{}") ||
      (rawValue.startsWith("[") && rawValue !== "[]")
    ) {
      contexts.push({ path });
      return null;
    }

    let value: unknown;
    try {
      value = JSON.parse(rawValue);
    } catch {
      return null;
    }
    if (
      path.length === 0 ||
      path[0] === excludedRootKey ||
      value === null ||
      (typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean")
    ) {
      return null;
    }
    return { field: path.join("."), value };
  });
}

/** Render JSON (object or pre-serialized string) with token colors. */
export function JsonView({ value, highlights, onQuickQuery }: Props) {
  let text: string;
  let markers: { open: string; close: string } | undefined;
  let excludedRootKey: string | undefined;

  if (
    highlights != null &&
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  ) {
    const rawFragments = Object.values(highlights).flat();
    const markerSource = `${JSON.stringify(value)}${rawFragments.join("")}`;
    let markerIndex = 0;
    let markerPair: { open: string; close: string };
    do {
      markerPair = {
        open: `__SEARCH_CLUSTER_HIGHLIGHT_OPEN_${markerIndex}__`,
        close: `__SEARCH_CLUSTER_HIGHLIGHT_CLOSE_${markerIndex}__`,
      };
      markerIndex += 1;
    } while (
      markerSource.includes(markerPair.open) ||
      markerSource.includes(markerPair.close)
    );
    markers = markerPair;

    const highlighted = Object.fromEntries(
      Object.entries(highlights).map(([field, fragments]) => [
        field,
        fragments.map((fragment) =>
          fragment
            .replace(/<em>/gi, markerPair.open)
            .replace(/<\/em>/gi, markerPair.close),
        ),
      ]),
    );
    const highlightKey = Object.prototype.hasOwnProperty.call(
      value,
      "_highlight",
    )
      ? "_search_highlight"
      : "_highlight";
    excludedRootKey = highlightKey;
    text =
      JSON.stringify({ ...value, [highlightKey]: highlighted }, null, 2) ?? "";
  } else {
    text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  }

  if (onQuickQuery) {
    const queries = getLineQueries(text, excludedRootKey);
    return (
      <>
        {text.split("\n").map((line, index) => {
          const query = queries[index];
          return (
            <span className="json-line" key={index}>
              <span
                className="json-line-content"
                dangerouslySetInnerHTML={{
                  __html: highlightJson(line, markers),
                }}
              />
              {query && (
                <button
                  type="button"
                  className="json-quick-query"
                  title={`Query ${query.field} with match`}
                  aria-label={`Query ${query.field} with match`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onQuickQuery(query.field, query.value);
                  }}
                >
                  ⌕
                </button>
              )}
            </span>
          );
        })}
      </>
    );
  }

  return (
    <span
      dangerouslySetInnerHTML={{ __html: highlightJson(text, markers) }}
    />
  );
}

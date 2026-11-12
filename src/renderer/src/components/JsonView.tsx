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
}

/** Render JSON (object or pre-serialized string) with token colors. */
export function JsonView({ value, highlights }: Props) {
  let text: string;
  let markers: { open: string; close: string } | undefined;

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
    text =
      JSON.stringify({ ...value, [highlightKey]: highlighted }, null, 2) ?? "";
  } else {
    text =
      typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
  }

  return (
    <span
      dangerouslySetInnerHTML={{ __html: highlightJson(text, markers) }}
    />
  );
}

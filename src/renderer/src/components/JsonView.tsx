import { Fragment, useState } from "react";
import type { ReactNode } from "react";

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
  collapsible?: boolean;
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

/* ========== Collapsible helpers ========== */

function getScalarValue(
  v: unknown,
): string | number | boolean | null {
  if (
    v === null ||
    typeof v === "string" ||
    typeof v === "number" ||
    typeof v === "boolean"
  ) {
    return v;
  }
  return null;
}

interface HighlightedStringProps {
  value: string;
  markers?: { open: string; close: string };
}

function HighlightedString({ value, markers }: HighlightedStringProps) {
  if (!markers || !value.includes(markers.open)) {
    return <>{value}</>;
  }
  const parts = value.split(markers.open);
  return (
    <>
      {parts.map((part, i) => {
        if (i === 0) return <span key={i}>{part}</span>;
        const [highlighted, ...rest] = part.split(markers.close);
        return (
          <Fragment key={i}>
            <mark className="json-highlight">{highlighted}</mark>
            {rest.join(markers.close)}
          </Fragment>
        );
      })}
    </>
  );
}

interface JsonNodeProps {
  value: unknown;
  depth: number;
  path: string[];
  queryPath?: string[];
  markers?: { open: string; close: string };
  onQuickQuery?: (field: string, value: string | number | boolean) => void;
  excludedRootKey?: string;
}

function JsonCollapsibleNode({
  value,
  depth,
  path,
  queryPath,
  markers,
  onQuickQuery,
  excludedRootKey,
}: JsonNodeProps): ReactNode {
  if (value === null) {
    return <span className="tok-null">null</span>;
  }

  if (typeof value === "boolean") {
    return <span className="tok-bool">{String(value)}</span>;
  }

  if (typeof value === "number") {
    return <span className="tok-num">{value}</span>;
  }

  if (typeof value === "string") {
    const isExcluded =
      excludedRootKey != null && path.length > 0 && path[0] === excludedRootKey;

    if (isExcluded) {
      // Highlight values are rendered as JSON strings with possible markers.
      return (
        <span className="tok-str">
          &quot;
          <HighlightedString value={value} markers={markers} />
          &quot;
        </span>
      );
    }

    return (
      <span className="tok-str">
        <HighlightedString value={JSON.stringify(value)} markers={markers} />
      </span>
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span>[]</span>;
    return (
      <JsonCollapsibleArray
        value={value}
        depth={depth}
        path={path}
        queryPath={queryPath}
        markers={markers}
        onQuickQuery={onQuickQuery}
        excludedRootKey={excludedRootKey}
      />
    );
  }

  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return <span>{"{}"}</span>;
    return (
      <JsonCollapsibleObject
        value={value as Record<string, unknown>}
        depth={depth}
        path={path}
        queryPath={queryPath}
        markers={markers}
        onQuickQuery={onQuickQuery}
        excludedRootKey={excludedRootKey}
      />
    );
  }

  return null;
}

function JsonCollapsibleObject({
  value,
  depth,
  path,
  queryPath,
  markers,
  onQuickQuery,
  excludedRootKey,
}: JsonNodeProps & { value: Record<string, unknown> }) {
  const [expanded, setExpanded] = useState(true);
  const keys = Object.keys(value);
  const isExcluded =
    excludedRootKey != null && path.length > 0 && path[0] === excludedRootKey;

  return (
    <>
      <span
        className="json-toggle"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        {expanded ? "▼" : "▶"}
      </span>
      {"{"}
      {!expanded && (
        <>
          {" "}
          <span className="json-collapsed-preview">{keys.length} keys</span>{" "}
        </>
      )}
      {expanded && (
        <>
          {keys.map((key, i) => {
            const childPath = [...path, key];
            const childQueryPath = [...(queryPath ?? path), key];
            const childValue = value[key];
            const scalar = getScalarValue(childValue);
            const showQuickQuery =
              !isExcluded && scalar !== null && onQuickQuery != null;

            return (
              <div
                key={key}
                className="json-line"
                style={{ paddingLeft: `${(depth + 1) * 2}ch` }}
              >
                <span className="tok-key">{JSON.stringify(key)}</span>
                {": "}
                <JsonCollapsibleNode
                  value={childValue}
                  depth={depth + 1}
                  path={childPath}
                  queryPath={childQueryPath}
                  markers={markers}
                  onQuickQuery={onQuickQuery}
                  excludedRootKey={excludedRootKey}
                />
                {i < keys.length - 1 ? "," : ""}
                {showQuickQuery && (
                  <button
                    type="button"
                    className="json-quick-query"
                    title={`Query ${childQueryPath.join(".")} with match`}
                    aria-label={`Query ${childQueryPath.join(".")} with match`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onQuickQuery!(childQueryPath.join("."), scalar!);
                    }}
                  >
                    ⌕
                  </button>
                )}
              </div>
            );
          })}
          <div
            className="json-line"
            style={{ paddingLeft: `${depth * 2}ch` }}
          >
            {"}"}
          </div>
        </>
      )}
      {!expanded && "}"}
    </>
  );
}

function JsonCollapsibleArray({
  value,
  depth,
  path,
  queryPath,
  markers,
  onQuickQuery,
  excludedRootKey,
}: JsonNodeProps & { value: unknown[] }) {
  const [expanded, setExpanded] = useState(true);
  const isExcluded =
    excludedRootKey != null && path.length > 0 && path[0] === excludedRootKey;

  return (
    <>
      <span
        className="json-toggle"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        {expanded ? "▼" : "▶"}
      </span>
      {"["}
      {!expanded && (
        <>
          {" "}
          <span className="json-collapsed-preview">
            {value.length} items
          </span>{" "}
        </>
      )}
      {expanded && (
        <>
          {value.map((item, i) => {
            const childPath = [...path, String(i)];
            // For arrays, quick query uses the array's field path, not the index.
            const childQueryPath = queryPath ?? path;
            const scalar = getScalarValue(item);
            const showQuickQuery =
              !isExcluded && scalar !== null && onQuickQuery != null;

            return (
              <div
                key={i}
                className="json-line"
                style={{ paddingLeft: `${(depth + 1) * 2}ch` }}
              >
                <JsonCollapsibleNode
                  value={item}
                  depth={depth + 1}
                  path={childPath}
                  queryPath={childQueryPath}
                  markers={markers}
                  onQuickQuery={onQuickQuery}
                  excludedRootKey={excludedRootKey}
                />
                {i < value.length - 1 ? "," : ""}
                {showQuickQuery && (
                  <button
                    type="button"
                    className="json-quick-query"
                    title={`Query ${childQueryPath.join(".")} with match`}
                    aria-label={`Query ${childQueryPath.join(".")} with match`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onQuickQuery!(childQueryPath.join("."), scalar!);
                    }}
                  >
                    ⌕
                  </button>
                )}
              </div>
            );
          })}
          <div
            className="json-line"
            style={{ paddingLeft: `${depth * 2}ch` }}
          >
            {"]"}
          </div>
        </>
      )}
      {!expanded && "]"}
    </>
  );
}

/** Render JSON (object or pre-serialized string) with token colors. */
export function JsonView({
  value,
  highlights,
  onQuickQuery,
  collapsible,
}: Props) {
  // ----- collapsible (interactive) mode -----
  if (collapsible) {
    let parsedValue: unknown;
    if (typeof value === "string") {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        return <pre>{value}</pre>;
      }
    } else {
      parsedValue = value;
    }

    let renderValue = parsedValue;
    let excludedRootKey: string | undefined;
    let activeMarkers: { open: string; close: string } | undefined;

    if (
      highlights != null &&
      typeof parsedValue === "object" &&
      parsedValue !== null &&
      !Array.isArray(parsedValue)
    ) {
      const rawFragments = Object.values(highlights).flat();
      const markerSource = `${JSON.stringify(parsedValue)}${rawFragments.join("")}`;
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
      activeMarkers = markerPair;

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
        parsedValue,
        "_highlight",
      )
        ? "_search_highlight"
        : "_highlight";
      excludedRootKey = highlightKey;
      renderValue = { ...parsedValue, [highlightKey]: highlighted };
    }

    return (
      <div className="json-collapsible">
        <JsonCollapsibleNode
          value={renderValue}
          depth={0}
          path={[]}
          markers={activeMarkers}
          onQuickQuery={onQuickQuery}
          excludedRootKey={excludedRootKey}
        />
      </div>
    );
  }

  // ----- plain (non-interactive) mode -----
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

import type {
  Completion,
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from '@codemirror/autocomplete'

/**
 * Context-aware autocompletion for the ES/OpenSearch query DSL.
 *
 * A Monaco + JSON-schema setup was considered, but it would add a ~5 MB
 * dependency and web-worker wiring to an app that already ships CodeMirror 6.
 * Instead, a small tolerant scanner recovers the JSON key path at the cursor
 * (even in incomplete/invalid JSON) and offers the DSL keys, clause names,
 * operators and index fields that are valid at that exact position.
 */

/** A mapping field with its full dotted path and ES/OS field type. */
export interface FieldInfo {
  path: string
  type: string
}

/* ------------------------------------------------------------------ */
/* Index mapping field extraction                                      */
/* ------------------------------------------------------------------ */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Locate the `properties` tree of a mappings object.
 * Handles both `{ properties: {...} }` and type-wrapped `{ doc: { properties: {...} } }`.
 */
function rootProperties(mappings: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(mappings.properties)) return mappings.properties
  const keys = Object.keys(mappings).filter((k) => isRecord(mappings[k]))
  if (keys.length === 1) {
    const wrapped = mappings[keys[0]]
    if (isRecord(wrapped) && isRecord(wrapped.properties)) return wrapped.properties
  }
  return null
}

function collectFields(props: Record<string, unknown>, prefix: string, out: FieldInfo[]): void {
  for (const [name, def] of Object.entries(props)) {
    if (!isRecord(def)) continue
    const path = prefix ? `${prefix}.${name}` : name
    const type = typeof def.type === 'string' ? def.type : 'object'
    out.push({ path, type })
    // object/nested fields: keep the parent path and also offer children
    if (isRecord(def.properties)) collectFields(def.properties, path, out)
    // multi-fields, e.g. `title` -> `title.keyword`
    if (isRecord(def.fields)) collectFields(def.fields, path, out)
  }
}

/** Flat list of fields (path + type) extracted from ES/OS mappings. */
export function extractFields(mappings: Record<string, unknown>): FieldInfo[] {
  const props = rootProperties(mappings)
  if (props == null) return []
  const out: FieldInfo[] = []
  collectFields(props, '', out)
  return out
}

/** Flat list of field paths extracted from ES/OS mappings (properties tree). */
export function extractFieldPaths(mappings: Record<string, unknown>): string[] {
  return extractFields(mappings).map((f) => f.path)
}

/* ------------------------------------------------------------------ */
/* Query DSL knowledge base                                            */
/* ------------------------------------------------------------------ */

interface KeyDef {
  label: string
  detail: string
}

/** Keys to offer for a JSON path (plus optional index fields). */
interface KeyContext {
  defs: KeyDef[]
  /** Also offer index field names (e.g. inside a `match` clause). */
  fields?: boolean
}

const NOTHING: KeyContext = { defs: [] }

const k = (label: string, detail: string): KeyDef => ({ label, detail })

const ROOT_KEYS: KeyDef[] = [
  k('query', 'query DSL'),
  k('size', 'number of hits to return'),
  k('from', 'offset'),
  k('sort', 'sorting'),
  k('_source', 'source filtering'),
  k('aggs', 'aggregations'),
  k('highlight', 'highlighting'),
  k('post_filter', 'filter applied after aggregations'),
  k('track_total_hits', 'total hits tracking'),
  k('min_score', 'exclude hits below score'),
  k('search_after', 'cursor-based pagination'),
  k('collapse', 'field collapsing'),
  k('explain', 'include score explanation'),
  k('profile', 'query profiling (per-shard timings)'),
  k('version', 'return document version'),
  k('stored_fields', 'stored fields to return'),
  k('script_fields', 'scripted fields'),
  k('timeout', 'search timeout'),
  k('terminate_after', 'early termination'),
]

const QUERY_CLAUSES: KeyDef[] = [
  k('bool', 'combine queries (must/should/filter)'),
  k('match', 'full-text match'),
  k('match_phrase', 'exact phrase match'),
  k('match_phrase_prefix', 'phrase prefix (search-as-you-type)'),
  k('multi_match', 'match across several fields'),
  k('term', 'exact term filter'),
  k('terms', 'any of several terms'),
  k('range', 'numeric/date range'),
  k('exists', 'field exists'),
  k('prefix', 'term prefix'),
  k('wildcard', 'wildcard pattern'),
  k('regexp', 'regular expression'),
  k('fuzzy', 'fuzzy match'),
  k('ids', 'match by _id'),
  k('match_all', 'match everything'),
  k('match_none', 'match nothing'),
  k('constant_score', 'wrap a filter with a constant score'),
  k('dis_max', 'disjunction max'),
  k('function_score', 'score functions'),
  k('boosting', 'positive/negative boosting'),
  k('nested', 'query nested documents'),
  k('query_string', 'Lucene query string'),
  k('simple_query_string', 'simplified query string'),
  k('script', 'script-based query'),
  k('geo_distance', 'geo distance'),
  k('geo_bounding_box', 'geo bounding box'),
]

const BOOL_KEYS: KeyDef[] = [
  k('must', 'must match (scored)'),
  k('must_not', 'must not match'),
  k('should', 'optional, improves score'),
  k('filter', 'must match (not scored)'),
  k('minimum_should_match', 'tuning for should clauses'),
  k('boost', 'boost the whole bool query'),
]

/** Clauses whose object keys are index field names. */
const FIELD_KEY_CLAUSES = new Set([
  'match',
  'match_phrase',
  'match_phrase_prefix',
  'term',
  'terms',
  'range',
  'prefix',
  'wildcard',
  'regexp',
  'fuzzy',
  'geo_distance',
  'geo_bounding_box',
])

/** Options available inside a clause object (per field or directly). */
const CLAUSE_OPTIONS: Record<string, KeyDef[]> = {
  match: [
    k('analyzer', 'analyzer name'),
    k('fuzziness', 'AUTO / 0 / 1 / 2'),
    k('max_expansions', 'prefix/fuzzy expansions'),
    k('prefix_length', 'prefix length for fuzzy'),
    k('operator', 'AND / OR'),
    k('minimum_should_match', 'tuning'),
    k('boost', 'score boost'),
  ],
  match_phrase: [k('analyzer', 'analyzer name'), k('slop', 'word distance'), k('boost', 'score boost')],
  match_phrase_prefix: [
    k('analyzer', 'analyzer name'),
    k('slop', 'word distance'),
    k('max_expansions', 'prefix expansions'),
    k('boost', 'score boost'),
  ],
  multi_match: [
    k('query', 'query text'),
    k('fields', 'field list, e.g. ["title", "name^2"]'),
    k('type', 'best_fields / most_fields / …'),
    k('tie_breaker', 'tie breaker score'),
    k('analyzer', 'analyzer name'),
    k('operator', 'AND / OR'),
    k('minimum_should_match', 'tuning'),
    k('fuzziness', 'AUTO / 0 / 1 / 2'),
    k('boost', 'score boost'),
  ],
  term: [k('boost', 'score boost')],
  terms: [k('boost', 'score boost')],
  range: [
    k('gte', 'greater than or equal'),
    k('gt', 'greater than'),
    k('lte', 'less than or equal'),
    k('lt', 'less than'),
    k('format', 'date format, e.g. yyyy-MM-dd'),
    k('time_zone', 'e.g. +03:00'),
    k('relation', 'WITHIN / CONTAINS / INTERSECTS'),
    k('boost', 'score boost'),
  ],
  prefix: [k('value', 'prefix value'), k('boost', 'score boost'), k('case_insensitive', 'true / false')],
  wildcard: [k('value', 'wildcard pattern'), k('boost', 'score boost'), k('case_insensitive', 'true / false')],
  regexp: [
    k('value', 'regular expression'),
    k('flags', 'regexp flags'),
    k('case_insensitive', 'true / false'),
    k('max_determinized_states', 'safety limit'),
    k('boost', 'score boost'),
  ],
  fuzzy: [
    k('value', 'fuzzy value'),
    k('fuzziness', 'AUTO / 0 / 1 / 2'),
    k('prefix_length', 'prefix length'),
    k('transpositions', 'true / false'),
    k('max_expansions', 'expansions'),
    k('boost', 'score boost'),
  ],
  exists: [k('field', 'field name'), k('boost', 'score boost')],
  ids: [k('values', '_id list'), k('boost', 'score boost')],
  match_all: [k('boost', 'score boost')],
  match_none: [],
  query_string: [
    k('query', 'query text'),
    k('default_field', 'default field'),
    k('fields', 'field list'),
    k('analyzer', 'analyzer name'),
    k('default_operator', 'AND / OR'),
    k('lenient', 'ignore format errors'),
    k('phrase_slop', 'phrase slop'),
    k('allow_leading_wildcard', 'true / false'),
    k('boost', 'score boost'),
  ],
  simple_query_string: [
    k('query', 'query text'),
    k('fields', 'field list'),
    k('default_operator', 'AND / OR'),
    k('flags', 'query syntax flags'),
    k('boost', 'score boost'),
  ],
  nested: [
    k('path', 'path to nested field'),
    k('query', 'nested query'),
    k('score_mode', 'avg / sum / max / min / none / first'),
    k('inner_hits', 'return nested hits'),
    k('ignore_unmapped', 'true / false'),
  ],
  constant_score: [k('filter', 'filter query'), k('boost', 'score boost')],
  dis_max: [k('queries', 'query list'), k('tie_breaker', 'tie breaker score'), k('boost', 'score boost')],
  function_score: [
    k('query', 'base query'),
    k('functions', 'score functions'),
    k('boost', 'score boost'),
    k('boost_mode', 'multiply / replace / sum / avg / max / min'),
    k('score_mode', 'avg / sum / max / min / none / first'),
    k('min_score', 'exclude below score'),
    k('max_boost', 'cap the boost'),
  ],
  boosting: [k('positive', 'positive query'), k('negative', 'negative query'), k('negative_boost', 'boost for negative')],
  geo_distance: [
    k('distance', 'e.g. 200km'),
    k('distance_type', 'arc / plane'),
    k('validation_method', 'STRICT / IGNORE_MALFORMED / COERCE'),
    k('boost', 'score boost'),
  ],
  geo_bounding_box: [
    k('top', 'top latitude'),
    k('left', 'left longitude'),
    k('bottom', 'bottom latitude'),
    k('right', 'right longitude'),
    k('top_left', 'top-left corner'),
    k('bottom_right', 'bottom-right corner'),
    k('validation_method', 'STRICT / IGNORE_MALFORMED / COERCE'),
    k('boost', 'score boost'),
  ],
  script: [k('script', 'painless script'), k('boost', 'score boost')],
}

/** Clause keys whose value is itself a query (recursion points). */
const QUERY_VAL_KEYS: Record<string, readonly string[]> = {
  bool: ['must', 'must_not', 'should', 'filter'],
  nested: ['query'],
  constant_score: ['filter'],
  function_score: ['query'],
  dis_max: ['queries'],
  boosting: ['positive', 'negative'],
}

const AGG_SUB_KEY = k('aggs', 'sub-aggregations')
const AGG_META_KEY = k('meta', 'aggregation metadata')

const AGG_NAMES: KeyDef[] = [
  k('terms', 'bucket: unique values of a field'),
  k('multi_terms', 'bucket: combination of several fields'),
  k('significant_terms', 'bucket: unusually frequent terms'),
  k('rare_terms', 'bucket: rare terms'),
  k('composite', 'bucket: composite sources (pagination)'),
  k('filter', 'bucket: single query filter'),
  k('filters', 'bucket: multiple named filters'),
  k('nested', 'bucket: roll up nested docs'),
  k('reverse_nested', 'bucket: out of nested context'),
  k('date_histogram', 'bucket: by date interval'),
  k('auto_date_histogram', 'bucket: auto date interval'),
  k('histogram', 'bucket: by numeric interval'),
  k('date_range', 'bucket: by date ranges'),
  k('range', 'bucket: by numeric ranges'),
  k('ip_range', 'bucket: by IP ranges'),
  k('avg', 'metric: average'),
  k('weighted_avg', 'metric: weighted average'),
  k('sum', 'metric: sum'),
  k('min', 'metric: minimum'),
  k('max', 'metric: maximum'),
  k('stats', 'metric: basic stats'),
  k('extended_stats', 'metric: extended stats'),
  k('cardinality', 'metric: distinct count'),
  k('value_count', 'metric: value count'),
  k('percentiles', 'metric: percentiles'),
  k('percentile_ranks', 'metric: percentile ranks'),
  k('top_hits', 'metric: top matching docs'),
  k('top_metrics', 'metric: top metric value'),
  k('missing', 'bucket: docs missing the field'),
  k('global', 'bucket: all docs, ignores query'),
  k('sampler', 'bucket: sample docs'),
  k('diversified_sampler', 'bucket: diversified sample'),
  k('scripted_metric', 'metric: custom script'),
  k('bucket_selector', 'pipeline: filter buckets'),
  k('bucket_sort', 'pipeline: sort buckets'),
  k('median_absolute_deviation', 'pipeline: median absolute deviation'),
]

const FIELD_OPTS: KeyDef[] = [
  k('field', 'field name'),
  k('missing', 'value for docs missing the field'),
  k('script', 'scripted value'),
]

const AGG_OPTIONS: Record<string, KeyDef[]> = {
  terms: [
    k('field', 'field name'),
    k('size', 'number of buckets'),
    k('shard_size', 'shard-level bucket count'),
    k('order', 'e.g. {"_count": "desc"}'),
    k('min_doc_count', 'minimum docs per bucket'),
    k('include', 'include pattern'),
    k('exclude', 'exclude pattern'),
    k('missing', 'value for missing docs'),
    k('script', 'scripted value'),
  ],
  multi_terms: [k('terms', 'list of {field, order}'), k('size', 'number of buckets'), k('order', 'sort order'), k('min_doc_count', 'minimum docs per bucket')],
  significant_terms: [k('field', 'field name'), k('size', 'number of buckets'), k('min_doc_count', 'minimum docs per bucket')],
  rare_terms: [k('field', 'field name'), k('max_doc_count', 'maximum docs per bucket')],
  composite: [k('sources', 'list of {name: agg}'), k('size', 'page size'), k('after', 'pagination cursor')],
  filters: [k('filters', 'named filters'), k('other_bucket', 'true / false'), k('other_bucket_key', 'bucket key')],
  nested: [k('path', 'path to nested field')],
  reverse_nested: [k('path', 'path back to parent')],
  date_histogram: [
    k('field', 'field name'),
    k('calendar_interval', 'year / quarter / month / week / day / …'),
    k('fixed_interval', '30m / 1d / 7d / …'),
    k('format', 'date format'),
    k('min_doc_count', 'minimum docs per bucket'),
    k('extended_bounds', 'extend bucket range'),
    k('order', 'sort order'),
    k('time_zone', 'e.g. +03:00'),
    k('offset', 'interval offset'),
    k('missing', 'value for missing docs'),
  ],
  auto_date_histogram: [k('field', 'field name'), k('buckets', 'target bucket count'), k('minimum_interval', 'minimum interval'), k('format', 'date format')],
  histogram: [k('field', 'field name'), k('interval', 'bucket width'), k('min_doc_count', 'minimum docs per bucket'), k('extended_bounds', 'extend bucket range'), k('order', 'sort order'), k('missing', 'value for missing docs')],
  date_range: [k('field', 'field name'), k('format', 'date format'), k('ranges', 'list of {from, to}'), k('time_zone', 'e.g. +03:00'), k('missing', 'value for missing docs')],
  range: [k('field', 'field name'), k('ranges', 'list of {from, to}'), k('keyed', 'true / false'), k('missing', 'value for missing docs')],
  ip_range: [k('field', 'field name'), k('ranges', 'list of {from, to}')],
  avg: FIELD_OPTS,
  weighted_avg: [k('value', 'value {field, missing}'), k('weight', 'weight {field, missing}')],
  sum: FIELD_OPTS,
  min: FIELD_OPTS,
  max: FIELD_OPTS,
  stats: FIELD_OPTS,
  extended_stats: [...FIELD_OPTS, k('sigma', 'stddev multiplier')],
  cardinality: [k('field', 'field name'), k('precision_threshold', 'precision threshold'), k('missing', 'value for missing docs')],
  value_count: [k('field', 'field name'), k('script', 'scripted value')],
  percentiles: [k('field', 'field name'), k('percents', 'percentile list'), k('keyed', 'true / false'), k('missing', 'value for missing docs')],
  percentile_ranks: [k('field', 'field name'), k('values', 'value list'), k('keyed', 'true / false')],
  top_hits: [k('size', 'hits per bucket'), k('from', 'offset'), k('sort', 'sorting'), k('_source', 'source filtering')],
  top_metrics: [k('metrics', 'metric {field}'), k('size', 'number of metrics')],
  missing: [k('field', 'field name')],
  global: [],
  sampler: [k('shard_size', 'sample size')],
  diversified_sampler: [k('field', 'diversify by field'), k('shard_size', 'sample size')],
  scripted_metric: [k('init_script', 'init script'), k('map_script', 'map script'), k('combine_script', 'combine script'), k('reduce_script', 'reduce script')],
  bucket_selector: [k('buckets_path', 'metric paths'), k('script', 'condition script')],
  bucket_sort: [k('sort', 'sorting'), k('from', 'offset'), k('size', 'bucket count')],
  median_absolute_deviation: [k('field', 'field name')],
}

/** Keys of `{"_count": "desc"}`-style order objects in the terms agg. */
const ORDER_BY_KEYS: KeyDef[] = [
  k('_count', 'sort by doc count'),
  k('_key', 'sort by term value'),
  k('_term', 'sort by term value (deprecated)'),
]

const SORT_ROOT: KeyContext = {
  defs: [k('_score', 'relevance score'), k('_doc', 'index order')],
  fields: true,
}

const SORT_FIELD_OPTS: KeyDef[] = [
  k('order', 'asc / desc'),
  k('mode', 'min / max / sum / avg / median'),
  k('missing', 'value for missing docs'),
  k('unmapped_type', 'type for unmapped fields'),
  k('numeric_type', 'numeric type coercion'),
  k('nested', 'nested sorting options'),
]

const HIGHLIGHT_KEYS: KeyDef[] = [
  k('fields', 'per-field highlight settings'),
  k('pre_tags', 'pre highlight tags'),
  k('post_tags', 'post highlight tags'),
  k('fragment_size', 'fragment length'),
  k('number_of_fragments', 'fragments per field'),
  k('order', 'score / none'),
  k('encoder', 'default / html'),
  k('boundary_scanner', 'sentence / word / chars'),
  k('require_field_match', 'true / false'),
  k('highlight_query', 'custom query to highlight'),
  k('type', 'unified / plain / fvh'),
  k('no_match_size', 'prefix length when no match'),
  k('fragmenter', 'simple / span'),
]

const HIGHLIGHT_FIELDS_ROOT: KeyContext = { defs: [k('*', 'all fields')], fields: true }

const HIGHLIGHT_FIELD_OPTS: KeyDef[] = [
  k('pre_tags', 'pre highlight tags'),
  k('post_tags', 'post highlight tags'),
  k('fragment_size', 'fragment length'),
  k('number_of_fragments', 'fragments per field'),
  k('highlight_query', 'custom query to highlight'),
  k('no_match_size', 'prefix length when no match'),
  k('type', 'unified / plain / fvh'),
  k('matched_fields', 'matched multi-fields'),
]

const SOURCE_OPTS: KeyDef[] = [
  k('includes', 'field patterns to include'),
  k('excludes', 'field patterns to exclude'),
]

/** Value suggestions for known property names (string values). */
const VALUE_OPTIONS: Record<string, KeyDef[]> = {
  operator: [k('AND', 'all terms must match'), k('OR', 'any term may match')],
  default_operator: [k('AND', 'all terms must match'), k('OR', 'any term may match')],
  relation: [k('WITHIN', 'range within the field value'), k('CONTAINS', 'field value within range'), k('INTERSECTS', 'ranges intersect')],
  score_mode: [k('avg', 'average'), k('sum', 'sum'), k('max', 'maximum'), k('min', 'minimum'), k('none', 'ignore scores'), k('first', 'first match')],
  boost_mode: [k('multiply', 'query score * function'), k('replace', 'function only'), k('sum', 'query score + function'), k('avg', 'average'), k('max', 'maximum'), k('min', 'minimum')],
  order: [k('asc', 'ascending'), k('desc', 'descending')],
  mode: [k('min', 'minimum'), k('max', 'maximum'), k('sum', 'sum'), k('avg', 'average'), k('median', 'median')],
  _count: [k('asc', 'ascending'), k('desc', 'descending')],
  _key: [k('asc', 'ascending'), k('desc', 'descending')],
  _term: [k('asc', 'ascending'), k('desc', 'descending')],
  calendar_interval: [k('year', 'one year'), k('quarter', 'one quarter'), k('month', 'one month'), k('week', 'one week'), k('day', 'one day'), k('hour', 'one hour'), k('minute', 'one minute'), k('second', 'one second')],
  fixed_interval: [k('30s', '30 seconds'), k('1m', 'one minute'), k('5m', '5 minutes'), k('10m', '10 minutes'), k('30m', '30 minutes'), k('1h', 'one hour'), k('12h', '12 hours'), k('1d', 'one day'), k('7d', 'one week'), k('30d', '30 days')],
  fuzziness: [k('AUTO', 'automatic'), k('0', 'no edits'), k('1', 'one edit'), k('2', 'two edits')],
  encoder: [k('default', 'no encoding'), k('html', 'html encoding')],
  boundary_scanner: [k('sentence', 'sentence boundaries'), k('word', 'word boundaries'), k('chars', 'character list')],
  fragmenter: [k('simple', 'fixed size'), k('span', 'phrase-aware')],
  validation_method: [k('STRICT', 'reject invalid'), k('IGNORE_MALFORMED', 'ignore invalid'), k('COERCE', 'try to coerce')],
  distance_type: [k('arc', 'arc (default)'), k('plane', 'plane')],
}

const HIGHLIGHT_TYPES: KeyDef[] = [
  k('unified', 'unified highlighter (default)'),
  k('plain', 'plain highlighter'),
  k('fvh', 'fast vector highlighter'),
]

const MULTI_MATCH_TYPES: KeyDef[] = [
  k('best_fields', 'best matching field (default)'),
  k('most_fields', 'sum across fields'),
  k('cross_fields', 'terms across fields'),
  k('phrase', 'match_phrase per field'),
  k('phrase_prefix', 'phrase prefix per field'),
  k('bool_prefix', 'bool prefix per field'),
]

/* ------------------------------------------------------------------ */
/* Tolerant path scanner                                               */
/* ------------------------------------------------------------------ */

interface ScanResult {
  mode: 'key' | 'value'
  /** Key path from the document root to the cursor (array levels are transparent). */
  path: string[]
  /** In value mode: the property name whose value is being typed. */
  propName?: string
}

/**
 * Scan the text *before* the cursor and recover the JSON key path at the
 * cursor position. Tolerant: the document does not have to be valid JSON
 * (which it never is while the user is typing).
 */
function scanPath(text: string): ScanResult {
  interface Frame {
    kind: 'obj' | 'arr'
    /** Property name this container is the value of (null at root / array elements). */
    key: string | null
    /** Property name whose value has not been completed yet. */
    pendingKey: string | null
    seenColon: boolean
  }
  const stack: Frame[] = [{ kind: 'obj', key: null, pendingKey: null, seenColon: false }]
  const path = () => stack.map((f) => f.key).filter((key): key is string => key != null)

  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]
    if (c === '{' || c === '[') {
      const parent = stack[stack.length - 1]
      const key = parent.kind === 'obj' ? parent.pendingKey : null
      stack.push({ kind: c === '{' ? 'obj' : 'arr', key, pendingKey: null, seenColon: false })
      i++
      continue
    }
    if (c === '}' || c === ']') {
      if (stack.length > 1) {
        stack.pop()
        const parent = stack[stack.length - 1]
        if (parent.kind === 'obj') {
          parent.pendingKey = null
          parent.seenColon = false
        }
      }
      i++
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\') j++
        j++
      }
      const closed = j < n
      const str = text.slice(i + 1, j)
      const frame = stack[stack.length - 1]
      if (frame.kind === 'obj') {
        if (!frame.seenColon) {
          // key position (or a partial key at the cursor)
          if (!closed) return { mode: 'key', path: path() }
          frame.pendingKey = str
        } else {
          // value position
          if (!closed) return { mode: 'value', path: path(), propName: frame.pendingKey ?? undefined }
          frame.pendingKey = null
          frame.seenColon = false
        }
      } else {
        // array element
        if (!closed) return { mode: 'value', path: path(), propName: frame.key ?? undefined }
      }
      i = closed ? j + 1 : n
      continue
    }
    if (c === ':') {
      const frame = stack[stack.length - 1]
      if (frame.kind === 'obj') frame.seenColon = true
      i++
      continue
    }
    if (c === ',') {
      const frame = stack[stack.length - 1]
      if (frame.kind === 'obj') {
        frame.pendingKey = null
        frame.seenColon = false
      }
      i++
      continue
    }
    if (/[^\s,{}\[\]:"']/.test(c)) {
      // bare word: number, true/false/null, or an unquoted token being typed
      let j = i
      while (j < n && /[^\s,{}\[\]:"']/.test(text[j])) j++
      const w = text.slice(i, j)
      const atCursor = j >= n
      const frame = stack[stack.length - 1]
      if (frame.kind === 'obj') {
        if (!frame.seenColon) {
          if (atCursor) return { mode: 'key', path: path() }
          frame.pendingKey = w
        } else {
          if (atCursor) return { mode: 'value', path: path(), propName: frame.pendingKey ?? undefined }
          frame.pendingKey = null
          frame.seenColon = false
        }
      } else {
        if (atCursor) return { mode: 'value', path: path(), propName: frame.key ?? undefined }
      }
      i = j
      continue
    }
    i++
  }
  const frame = stack[stack.length - 1]
  if (frame.kind === 'obj') {
    if (frame.seenColon) return { mode: 'value', path: path(), propName: frame.pendingKey ?? undefined }
    return { mode: 'key', path: path() }
  }
  return { mode: 'value', path: path(), propName: frame.key ?? undefined }
}

/* ------------------------------------------------------------------ */
/* Path -> completion context                                          */
/* ------------------------------------------------------------------ */

function queryContext(segs: string[]): KeyContext {
  if (segs.length === 0) return { defs: QUERY_CLAUSES }
  const clause = segs[0]
  if (segs.length === 1) {
    if (clause === 'bool') return { defs: BOOL_KEYS }
    if (FIELD_KEY_CLAUSES.has(clause)) return { defs: [], fields: true }
    return { defs: CLAUSE_OPTIONS[clause] ?? QUERY_CLAUSES }
  }
  const subKeys = QUERY_VAL_KEYS[clause]
  if (subKeys && subKeys.includes(segs[1])) return queryContext(segs.slice(2))
  if (FIELD_KEY_CLAUSES.has(clause) && segs.length === 2) {
    return { defs: CLAUSE_OPTIONS[clause] ?? [] }
  }
  return NOTHING
}

function aggContext(segs: string[]): KeyContext {
  if (segs.length === 0) return NOTHING // user-defined aggregation name
  if (segs.length === 1) return { defs: [...AGG_NAMES, AGG_SUB_KEY, AGG_META_KEY] }
  const t = segs[1]
  if (t === 'aggs') return aggContext(segs.slice(2))
  if (t === 'meta') return NOTHING
  if (t === 'filter') return queryContext(segs.slice(2))
  if (t === 'terms' && segs.length === 3 && segs[2] === 'order') return { defs: ORDER_BY_KEYS }
  if (segs.length === 2) return { defs: AGG_OPTIONS[t] ?? [] }
  return NOTHING
}

function keyContextFor(path: string[]): KeyContext {
  if (path.length === 0) return { defs: ROOT_KEYS }
  const head = path[0]
  if (head === 'query' || head === 'post_filter') return queryContext(path.slice(1))
  if (head === 'aggs' || head === 'aggregations') return aggContext(path.slice(1))
  if (head === 'sort') {
    return path.length === 1 ? SORT_ROOT : { defs: SORT_FIELD_OPTS }
  }
  if (head === 'highlight') {
    if (path.length === 1) return { defs: HIGHLIGHT_KEYS }
    if (path[1] === 'fields') {
      return path.length === 2 ? HIGHLIGHT_FIELDS_ROOT : { defs: HIGHLIGHT_FIELD_OPTS }
    }
    return NOTHING
  }
  if (head === '_source' && path.length === 1) return { defs: SOURCE_OPTS }
  // Unknown context: fall back to index fields (previous behavior).
  return { defs: [], fields: true }
}

function valueOptionsFor(propName: string, path: string[]): KeyDef[] | null {
  if (propName === 'type') {
    if (path.includes('highlight')) return HIGHLIGHT_TYPES
    if (path[0] === 'query') return MULTI_MATCH_TYPES
    return null
  }
  return VALUE_OPTIONS[propName] ?? null
}

/* ------------------------------------------------------------------ */
/* Completion source                                                   */
/* ------------------------------------------------------------------ */

/** Index field completions matching on the full path or the last segment. */
function fieldCompletions(fields: FieldInfo[], prefix: string): Completion[] {
  const lower = prefix.toLowerCase()
  const lastSegment = prefix.slice(prefix.lastIndexOf('.') + 1).toLowerCase()
  const out: Completion[] = []
  for (const f of fields) {
    const pathLower = f.path.toLowerCase()
    let matched: boolean
    if (prefix.endsWith('.')) {
      // "user." — offer children of that parent only
      matched = pathLower.startsWith(lower)
    } else {
      const fieldLast = f.path.slice(f.path.lastIndexOf('.') + 1).toLowerCase()
      matched = pathLower.startsWith(lower) || fieldLast.startsWith(lastSegment)
    }
    if (matched) out.push({ label: f.path, type: 'property', detail: f.type })
  }
  return out
}

/** Insert a key: reuse the user's opening quote, add the closing quote + colon. */
function keyApply(label: string, prevChar: string, nextChar: string): string {
  if (prevChar === '"') return nextChar === '"' ? label : `${label}": `
  return `"${label}": `
}

/** Insert a value: reuse the user's opening quote when present. */
function valueApply(label: string, prevChar: string): string {
  return prevChar === '"' ? label : `"${label}"`
}

/**
 * CodeMirror completion source for the ES/OS query DSL. `fields` is a getter
 * so the source always sees fresh mapping data without being recreated.
 */
export function queryCompletionSource(fields: () => FieldInfo[]): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const { state, pos } = context

    const word = context.matchBefore(/[\w.*]+/)
    let from: number
    let prefix: string
    if (word && word.text.length > 0) {
      from = word.from
      prefix = word.text
    } else if (context.explicit) {
      // Ctrl+Space with nothing typed yet: offer everything for this position.
      from = word ? word.from : pos
      prefix = word ? word.text : ''
    } else {
      return null
    }

    const scan = scanPath(state.doc.sliceString(0, pos))
    const prevChar = from > 0 ? state.doc.sliceString(from - 1, from) : ''
    const nextChar = state.doc.sliceString(pos, pos + 1)
    const lower = prefix.toLowerCase()

    if (scan.mode === 'value') {
      const propName = scan.propName ?? ''
      const defs = valueOptionsFor(propName, scan.path)
      let options: Completion[]
      if (defs != null) {
        const filtered = defs.filter((d) => d.label.toLowerCase().startsWith(lower))
        if (filtered.length === 0) return null
        options = filtered.map((d) => ({
          label: d.label,
          type: 'constant',
          detail: d.detail,
          apply: valueApply(d.label, prevChar),
        }))
      } else if (propName === 'field' || propName === 'path' || propName === 'fields') {
        options = fieldCompletions(fields(), prefix)
      } else {
        return null
      }
      if (options.length === 0) return null
      return { from, options, validFor: /^[\w.*]*$/ }
    }

    // Key mode: offer DSL keys (and/or index fields) valid at this path.
    const ctx = keyContextFor(scan.path)
    const options: Completion[] = []
    for (const d of ctx.defs) {
      if (!d.label.toLowerCase().startsWith(lower)) continue
      options.push({
        label: d.label,
        type: 'keyword',
        detail: d.detail,
        apply: keyApply(d.label, prevChar, nextChar),
      })
    }
    if (ctx.fields) options.push(...fieldCompletions(fields(), prefix))
    if (options.length === 0) return null
    return { from, options, validFor: /^[\w.*]*$/ }
  }
}

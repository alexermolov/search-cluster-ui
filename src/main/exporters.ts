import type { SearchHit } from '../shared/types'

/** Serialize hits (index/id/source) as pretty-printed JSON. */
export function hitsToJson(hits: SearchHit[]): string {
  return JSON.stringify(
    hits.map((h) => ({ _index: h._index, _id: h._id, _source: h._source })),
    null,
    2,
  )
}

// CSV serialization lives in src/shared/csv.ts so the renderer (export
// dialog column preview) can reuse the same helpers; re-exported here to
// keep the existing import in main/ipc.ts unchanged.
export { hitsToCsv } from '../shared/csv'

/** Small in-memory TTL cache for source field metadata (used to validate every pivot request). */

import { getFields } from "./catalog"
import type { Field, Source } from "./types"

const TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { at: number; fields: Promise<Field[]> }>()

function key(s: Source) {
  return JSON.stringify([s.kind, s.database, s.schema, s.name, s.model?.tables.map((t) => [t.database, t.schema, t.name, t.alias]) ?? null])
}

export function getCachedFields(src: Source, refresh = false): Promise<Field[]> {
  const k = key(src)
  const hit = cache.get(k)
  if (!refresh && hit && Date.now() - hit.at < TTL_MS) return hit.fields
  const fields = getFields(src)
  cache.set(k, { at: Date.now(), fields })
  fields.catch(() => cache.delete(k))
  return fields
}

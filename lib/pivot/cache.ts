/**
 * Small in-memory TTL cache for source field metadata (used to validate every pivot request).
 * Scoped per calling user: with caller's rights, two users may see different columns.
 */

import { getFields } from "./catalog"
import { callerKey } from "./caller"
import type { Field, Source } from "./types"

const TTL_MS = 5 * 60 * 1000
const MAX_ENTRIES = 2000
const cache = new Map<string, { at: number; fields: Promise<Field[]> }>()

function key(user: string, s: Source) {
  return JSON.stringify([user, s.kind, s.database, s.schema, s.name, s.model?.tables.map((t) => [t.database, t.schema, t.name, t.alias]) ?? null])
}

export async function getCachedFields(src: Source, refresh = false): Promise<Field[]> {
  const k = key(await callerKey(), src)
  const hit = cache.get(k)
  if (!refresh && hit && Date.now() - hit.at < TTL_MS) return hit.fields
  if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  const fields = getFields(src)
  cache.set(k, { at: Date.now(), fields })
  fields.catch(() => cache.delete(k))
  return fields
}

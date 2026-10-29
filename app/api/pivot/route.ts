/**
 * Run a pivot query.
 *   POST /api/pivot  { source, spec }  →  PivotResponse
 */

import { defaultWarehouse, requestedWarehouse, userQueryLongRunning } from "@/lib/pivot/caller"
import { getCachedFields } from "@/lib/pivot/cache"
import { parseSource } from "@/lib/pivot/catalog"
import { buildPivotQuery } from "@/lib/pivot/sql"
import { errorResponse } from "@/lib/api"
import { DEFAULT_LIMIT, type PivotResponse, type PivotSpec } from "@/lib/pivot/types"

export const dynamic = "force-dynamic"

function parseSpec(input: unknown): PivotSpec {
  const s = (input ?? {}) as Partial<PivotSpec>
  const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    rows: arr(s.rows),
    columns: arr(s.columns),
    values: arr(s.values),
    filters: arr(s.filters),
    totals: Boolean(s.totals),
    limit: typeof s.limit === "number" ? s.limit : DEFAULT_LIMIT,
  }
}

function normalize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString()
  if (typeof v === "bigint") return Number(v)
  return v
}

export async function POST(req: Request) {
  let sql = ""
  try {
    const body = await req.json()
    const source = parseSource(body.source)
    const spec = parseSpec(body.spec)
    const fields = await getCachedFields(source)
    const built = buildPivotQuery(source, fields, spec)
    sql = built.sql

    const warehouse = await requestedWarehouse()
    const t0 = Date.now()
    const raw = await userQueryLongRunning(built.sql, built.binds, { maxWaitMs: 5 * 60 * 1000, ...(warehouse ? { warehouse } : {}) })
    const elapsedMs = Date.now() - t0

    const truncated = raw.length > built.limit
    const rows = (truncated ? raw.slice(0, built.limit) : raw).map((r) => {
      const o: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(r)) o[k] = normalize(v)
      return o
    })
    const res: PivotResponse = { sql: built.sql, rows, truncated, elapsedMs, warehouse: warehouse ?? (await defaultWarehouse()) }
    return Response.json(res)
  } catch (e) {
    return errorResponse(e, req, "pivot", { sql })
  }
}

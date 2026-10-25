/**
 * Distinct values for a filter picker.
 *   POST /api/values  { source, fieldId, search? }  →  { values: unknown[] }
 */

import { userQuery } from "@/lib/pivot/caller"
import { getCachedFields } from "@/lib/pivot/cache"
import { parseSource } from "@/lib/pivot/catalog"
import { buildValuesQuery, PivotError } from "@/lib/pivot/sql"
import { errorResponse } from "@/lib/api"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const source = parseSource(body.source)
    const fields = await getCachedFields(source)
    const field = fields.find((f) => f.id === body.fieldId)
    if (!field) throw new PivotError("e.unknownField", { id: String(body.fieldId) })
    const search = typeof body.search === "string" && body.search.trim() ? body.search.trim().slice(0, 200) : undefined
    const { sql, binds } = buildValuesQuery(source, field, search)
    const rows = await userQuery(sql, binds)
    const values = rows.map((r) => (r.v instanceof Date ? r.v.toISOString() : r.v))
    return Response.json({ values })
  } catch (e) {
    return errorResponse(e, req, "values")
  }
}

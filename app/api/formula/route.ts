/**
 * Validate a calculated-metric formula against a source's fields.
 *   POST /api/formula  { source, formula }  →  { sql }  |  400 { error }
 */

import { errorResponse } from "@/lib/api"
import { getCachedFields } from "@/lib/pivot/cache"
import { parseSource } from "@/lib/pivot/catalog"
import { previewCalcSql } from "@/lib/pivot/sql"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const src = parseSource(body.source)
    const fields = await getCachedFields(src, false)
    return Response.json({ sql: previewCalcSql(src, fields, String(body.formula ?? "")) })
  } catch (e) {
    return errorResponse(e, req, "formula")
  }
}

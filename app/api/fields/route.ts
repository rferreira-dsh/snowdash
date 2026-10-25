/**
 * Field metadata for any source, including data models.
 *   POST /api/fields  { source, refresh? }  →  Field[]
 */

import { errorResponse } from "@/lib/api"
import { getCachedFields } from "@/lib/pivot/cache"
import { parseSource } from "@/lib/pivot/catalog"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const src = parseSource(body.source)
    return Response.json(await getCachedFields(src, body.refresh === true))
  } catch (e) {
    return errorResponse(e, req, "fields")
  }
}

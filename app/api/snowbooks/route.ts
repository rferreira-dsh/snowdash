/**
 * SnowBooks list.
 *   GET /api/snowbooks  →  [{ id, name, kind, base, tables, sheets, updatedAt, ... }]
 */

import { listBooks } from "@/lib/snowbooks"
import { errorResponse } from "@/lib/api"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    return Response.json(await listBooks())
  } catch (e) {
    return errorResponse(e, req, "snowbooks:list")
  }
}

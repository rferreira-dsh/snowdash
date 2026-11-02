/**
 * Admin: the service user's in-flight queries (SNOWDASH_ADMIN_USERS only).
 *   GET /api/admin/queries[?hours=24]  →  { serviceUser, hours, queries: ServiceQuery[] }
 *   hours: look-back window, 1–167 (default 24; long windows are slow).
 */

import { assertAdmin, clampHours, listServiceQueries } from "@/lib/pivot/admin"
import { errorResponse } from "@/lib/api"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    await assertAdmin()
    return Response.json(await listServiceQueries(clampHours(new URL(req.url).searchParams.get("hours") ?? undefined)))
  } catch (e) {
    return errorResponse(e, req, "admin-queries")
  }
}

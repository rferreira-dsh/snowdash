/**
 * Admin: cancel service-user queries (SNOWDASH_ADMIN_USERS only).
 *   POST /api/admin/queries/cancel
 *     { queryIds: string[], hours?: number }                         → cancel exactly these
 *     { minMinutes?: number, warehouse?: string, hours?: number }    → cancel by age (default 10 min)
 *   → { serviceUser, hours, cancelled: [{ queryId, warehouse, minutes, result }], notFound: string[] }
 * `hours` is the look-back window used to (re)list candidates (default 24, max 167).
 */

import { assertAdmin, cancelServiceQueries, clampHours } from "@/lib/pivot/admin"
import { errorResponse } from "@/lib/api"

export const dynamic = "force-dynamic"

const DEFAULT_MIN_MINUTES = 10

export async function POST(req: Request) {
  try {
    await assertAdmin()
    const body = (await req.json().catch(() => ({}))) as {
      queryIds?: unknown
      minMinutes?: unknown
      warehouse?: unknown
      hours?: unknown
    }
    const hours = clampHours(body.hours)
    if (Array.isArray(body.queryIds)) {
      const queryIds = body.queryIds.filter((x): x is string => typeof x === "string").slice(0, 500)
      return Response.json(await cancelServiceQueries({ queryIds }, hours))
    }
    const n = Number(body.minMinutes ?? DEFAULT_MIN_MINUTES)
    const minMinutes = Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MIN_MINUTES
    const warehouse = typeof body.warehouse === "string" && body.warehouse.trim() ? body.warehouse.trim().toUpperCase() : undefined
    return Response.json(await cancelServiceQueries({ minMinutes, warehouse }, hours))
  } catch (e) {
    return errorResponse(e, req, "admin-cancel")
  }
}

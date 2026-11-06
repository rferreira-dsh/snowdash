/**
 * Shelf limits available to the calling login.
 *   GET /api/limits  →  LimitsInfo
 */

import { isAdmin } from "@/lib/pivot/admin"
import { configuredLimits } from "@/lib/pivot/limits"
import { errorResponse } from "@/lib/api"
import type { LimitsInfo } from "@/lib/pivot/types"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const res: LimitsInfo = { ...configuredLimits(), admin: await isAdmin() }
    return Response.json(res)
  } catch (e) {
    return errorResponse(e, req, "limits")
  }
}

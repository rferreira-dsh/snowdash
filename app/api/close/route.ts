/**
 * Close the app for the calling user: cancel their in-flight queries (running or queued).
 *   POST /api/close  →  { cancelled: number }
 */

import { cancelCallerQueries } from "@/lib/pivot/caller"
import { errorResponse } from "@/lib/api"

export const dynamic = "force-dynamic"

export async function POST(req: Request) {
  try {
    return Response.json({ cancelled: await cancelCallerQueries() })
  } catch (e) {
    return errorResponse(e, req, "close")
  }
}

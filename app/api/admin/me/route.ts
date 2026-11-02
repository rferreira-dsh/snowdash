/**
 * Whether the calling login may use the admin tools.
 *   GET /api/admin/me  →  { admin: boolean }
 */

import { isAdmin } from "@/lib/pivot/admin"
import { errorResponse } from "@/lib/api"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    return Response.json({ admin: await isAdmin() })
  } catch (e) {
    return errorResponse(e, req, "admin-me")
  }
}

/**
 * Warehouses available for running queries.
 *   GET /api/warehouses[?refresh=1]  →  { default: string | null, warehouses: WarehouseInfo[] }
 */

import { defaultWarehouse, listWarehouses } from "@/lib/pivot/caller"
import { errorResponse } from "@/lib/api"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  try {
    const refresh = new URL(req.url).searchParams.get("refresh") === "1"
    const [warehouses, def] = await Promise.all([listWarehouses(refresh), defaultWarehouse()])
    return Response.json({ default: def, warehouses })
  } catch (e) {
    return errorResponse(e, req, "warehouses")
  }
}

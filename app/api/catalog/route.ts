/**
 * Catalog browsing.
 *   GET /api/catalog?level=databases
 *   GET /api/catalog?level=schemas&database=DB
 *   GET /api/catalog?level=objects&database=DB&schema=S
 *   GET /api/catalog?level=fields&database=DB&schema=S&name=T&kind=TABLE|VIEW|SEMANTIC_VIEW
 */

import { errorResponse, messageResponse } from "@/lib/api"
import { getCachedFields } from "@/lib/pivot/cache"
import { listDatabases, listObjects, listSchemas, parseSource } from "@/lib/pivot/catalog"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const p = new URL(req.url).searchParams
  const level = p.get("level")
  try {
    switch (level) {
      case "databases":
        return Response.json(await listDatabases())
      case "schemas": {
        const db = p.get("database")
        if (!db) return messageResponse(req, "e.required", { name: "database" })
        return Response.json(await listSchemas(db))
      }
      case "objects": {
        const db = p.get("database")
        const schema = p.get("schema")
        if (!db || !schema) return messageResponse(req, "e.required", { name: "database, schema" })
        return Response.json(await listObjects(db, schema))
      }
      case "fields": {
        const src = parseSource({
          database: p.get("database"),
          schema: p.get("schema"),
          name: p.get("name"),
          kind: p.get("kind"),
        })
        return Response.json(await getCachedFields(src, p.get("refresh") === "1"))
      }
      default:
        return messageResponse(req, "e.badLevel")
    }
  } catch (e) {
    return errorResponse(e, req, `catalog:${level}`)
  }
}

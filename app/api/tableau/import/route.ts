/**
 * Import a Tableau workbook (.twb XML) as an unsaved SnowBook.
 *   POST /api/tableau/import  { xml, datasource?, remap?: { database?: {from: to}, schema?: {from: to} } }
 *   → { datasources, datasource, source, sheets, warehouse, warnings, errors }
 * Nothing is saved; the client opens the result and the user saves it as usual.
 */

import { errorResponse, messageResponse } from "@/lib/api"
import { parseSource } from "@/lib/pivot/catalog"
import { convertWorkbook, type Remap } from "@/lib/tableau/convert"
import { parseTwb } from "@/lib/tableau/twb"
import { validateImport } from "@/lib/tableau/validate"

export const dynamic = "force-dynamic"

const MAX_XML = 10_000_000

function parseRemap(input: unknown): Remap {
  const m = (input ?? {}) as Record<string, unknown>
  const map = (v: unknown) => {
    if (!v || typeof v !== "object" || Array.isArray(v)) return undefined
    const out: Record<string, string> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 50)) {
      if (typeof x === "string" && x.trim() && x.length <= 255 && k.length <= 255) out[k] = x.trim()
    }
    return out
  }
  return { database: map(m.database), schema: map(m.schema) }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const xml = body?.xml
    if (typeof xml !== "string" || !xml.trim()) return messageResponse(req, "tb.noFile")
    if (xml.length > MAX_XML) return messageResponse(req, "tb.tooLarge", { mb: MAX_XML / 1_000_000 })
    let wb
    try {
      wb = parseTwb(xml)
    } catch {
      return messageResponse(req, "tb.notTwb")
    }
    const converted = convertWorkbook(wb, {
      datasource: typeof body.datasource === "string" ? body.datasource : undefined,
      remap: parseRemap(body.remap),
    })
    const result = await validateImport(converted)
    // Same validation as a saved SnowBook source (aliases, limits, labels…).
    result.source = parseSource(result.source)
    return Response.json(result)
  } catch (e) {
    return errorResponse(e, req, "tableau-import")
  }
}

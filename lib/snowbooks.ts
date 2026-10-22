/** SnowBook persistence (data model + pivot sheets) in a Snowflake table. */

import { headers } from "next/headers"
import { querySnowflake } from "@/lib/snowflake"
import { parseSource } from "./pivot/catalog"
import type { Source } from "./pivot/types"
import { AppError } from "./i18n/messages"

/** Fully-qualified table; configurable via env, never from user input. */
const TABLE = process.env.SNOWDASH_BOOKS_TABLE || "LABS.SNOWDASH.SNOWBOOKS"
const MAX_JSON_BYTES = 1_000_000
const ID_RE = /^[0-9a-f-]{36}$/i

export interface Sheet {
  id: string
  name: string
  spec: unknown
  view?: "table" | "chart"
  chartKind?: string
  heatmap?: boolean
}

export interface SnowBook {
  id: string
  name: string
  description?: string | null
  source: Source
  sheets: Sheet[]
  createdBy?: string | null
  createdAt?: string | null
  updatedBy?: string | null
  updatedAt?: string | null
}

export class BookError extends AppError {}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v))
const json = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v)

export function assertId(id: string) {
  if (!ID_RE.test(id)) throw new BookError("e.badId")
}

/** Calling user in SPCS (ingress header); falls back to the session user locally. */
async function currentUser(): Promise<string | null> {
  try {
    const h = await headers()
    return h.get("sf-context-current-user")
  } catch {
    return null
  }
}

export async function listBooks() {
  const rows = await querySnowflake(
    `SELECT ID, NAME, DESCRIPTION, SOURCE:kind::STRING AS KIND, SOURCE:name::STRING AS BASE,
            ARRAY_SIZE(SOURCE:model:tables) AS NTABLES, ARRAY_SIZE(SHEETS) AS NSHEETS,
            UPDATED_BY, UPDATED_AT
       FROM ${TABLE} ORDER BY UPDATED_AT DESC LIMIT 500`,
  )
  return rows.map((r) => ({
    id: String(r.ID),
    name: String(r.NAME),
    description: r.DESCRIPTION ?? null,
    kind: r.KIND,
    base: r.BASE,
    tables: r.NTABLES == null ? 1 : Number(r.NTABLES),
    sheets: Number(r.NSHEETS ?? 0),
    updatedBy: r.UPDATED_BY ?? null,
    updatedAt: iso(r.UPDATED_AT),
  }))
}

export async function getBook(id: string): Promise<SnowBook | null> {
  assertId(id)
  const rows = await querySnowflake(`SELECT * FROM ${TABLE} WHERE ID = ?`, { binds: [id] })
  const r = rows[0]
  if (!r) return null
  return {
    id: String(r.ID),
    name: String(r.NAME),
    description: r.DESCRIPTION ?? null,
    source: json(r.SOURCE),
    sheets: json(r.SHEETS),
    createdBy: r.CREATED_BY ?? null,
    createdAt: iso(r.CREATED_AT),
    updatedBy: r.UPDATED_BY ?? null,
    updatedAt: iso(r.UPDATED_AT),
  }
}

function parseSheets(input: unknown): Sheet[] {
  if (!Array.isArray(input) || input.length === 0 || input.length > 50) throw new BookError("e.badSheets")
  return input.map((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>
    return {
      id: typeof s.id === "string" ? s.id.slice(0, 64) : `s${i}`,
      name: typeof s.name === "string" && s.name.trim() ? s.name.trim().slice(0, 100) : `Planilha ${i + 1}`,
      spec: s.spec ?? {},
      view: s.view === "chart" ? "chart" : "table",
      chartKind: typeof s.chartKind === "string" ? s.chartKind.slice(0, 20) : "bar",
      heatmap: Boolean(s.heatmap),
    }
  })
}

export async function saveBook(id: string, body: Record<string, unknown>): Promise<SnowBook> {
  assertId(id)
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : ""
  if (!name) throw new BookError("e.needName")
  const description = typeof body.description === "string" ? body.description.slice(0, 2000) : null
  let source: Source
  try {
    source = parseSource(body.source)
  } catch (e) {
    if (e instanceof AppError) throw new BookError(e.key, e.vars)
    throw new BookError("e.badKind")
  }
  const sheets = parseSheets(body.sheets)
  const srcJson = JSON.stringify(source)
  const sheetsJson = JSON.stringify(sheets)
  if (srcJson.length + sheetsJson.length > MAX_JSON_BYTES) throw new BookError("e.tooBig")

  const user = await currentUser()
  await querySnowflake(
    `MERGE INTO ${TABLE} t
     USING (SELECT ? AS ID, ? AS NAME, ? AS DESCRIPTION, PARSE_JSON(?) AS SOURCE, PARSE_JSON(?) AS SHEETS,
                   COALESCE(?, CURRENT_USER()) AS USR) s
        ON t.ID = s.ID
     WHEN MATCHED THEN UPDATE SET NAME = s.NAME, DESCRIPTION = s.DESCRIPTION, SOURCE = s.SOURCE, SHEETS = s.SHEETS,
                                  UPDATED_BY = s.USR, UPDATED_AT = CURRENT_TIMESTAMP()
     WHEN NOT MATCHED THEN INSERT (ID, NAME, DESCRIPTION, SOURCE, SHEETS, CREATED_BY, UPDATED_BY)
                           VALUES (s.ID, s.NAME, s.DESCRIPTION, s.SOURCE, s.SHEETS, s.USR, s.USR)`,
    { binds: [id, name, description, srcJson, sheetsJson, user] },
  )
  const saved = await getBook(id)
  if (!saved) throw new Error("Falha ao salvar")
  return saved
}

export async function deleteBook(id: string) {
  assertId(id)
  await querySnowflake(`DELETE FROM ${TABLE} WHERE ID = ?`, { binds: [id] })
}

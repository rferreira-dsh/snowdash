/** Server-side catalog discovery (owner's rights). */

import { userQuery } from "./caller"
import { quoteIdent } from "./sql"
import { AppError } from "../i18n/messages"
import { parseFolders } from "./folders"
import {
  CURRENCIES,
  MAX_CALCS,
  MAX_MODEL_TABLES,
  type CalcFormat,
  type CalcMetric,
  type DataModel, type Field, type FieldFamily, type ModelTable, type Source, type SourceKind } from "./types"

function str(v: unknown): string {
  return v === null || v === undefined ? "" : String(v)
}

/** SHOW output column names are lowercase; tolerate either case. */
function col(row: Record<string, unknown>, name: string): string {
  return str(row[name] ?? row[name.toUpperCase()])
}

export function familyOf(dataType: string): FieldFamily {
  const t = dataType.toUpperCase()
  if (/^(NUMBER|DECIMAL|NUMERIC|INT|INTEGER|BIGINT|SMALLINT|TINYINT|BYTEINT|FLOAT|DOUBLE|REAL)/.test(t)) return "number"
  if (/^(DATE|TIMESTAMP|DATETIME|TIME)/.test(t)) return "date"
  if (/^(VARCHAR|CHAR|STRING|TEXT|CHARACTER)/.test(t)) return "text"
  if (/^BOOLEAN/.test(t)) return "boolean"
  return "other"
}

export async function listDatabases(): Promise<{ name: string; kind: string }[]> {
  const rows = await userQuery("SHOW TERSE DATABASES")
  return rows
    .map((r) => ({ name: col(r, "name"), kind: col(r, "kind") }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listSchemas(database: string): Promise<string[]> {
  const rows = await userQuery(`SHOW TERSE SCHEMAS IN DATABASE ${quoteIdent(database)}`)
  return rows
    .map((r) => col(r, "name"))
    .filter((n) => n !== "INFORMATION_SCHEMA")
    .sort()
}

export interface CatalogObject {
  name: string
  kind: SourceKind
  comment?: string
  rows?: number | null
}

export async function listObjects(database: string, schema: string): Promise<CatalogObject[]> {
  const db = quoteIdent(database)
  const [tables, semantic] = await Promise.all([
    userQuery(
      `SELECT TABLE_NAME, TABLE_TYPE, ROW_COUNT, COMMENT
         FROM ${db}.INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = ?
        ORDER BY TABLE_NAME`,
      [schema],
    ),
    userQuery(`SHOW SEMANTIC VIEWS IN SCHEMA ${db}.${quoteIdent(schema)}`).catch(() => []),
  ])

  const objs: CatalogObject[] = semantic.map((r) => ({
    name: col(r, "name"),
    kind: "SEMANTIC_VIEW" as const,
    comment: col(r, "comment") || undefined,
  }))
  for (const r of tables) {
    const type = str(r.TABLE_TYPE)
    objs.push({
      name: str(r.TABLE_NAME),
      kind: type.includes("VIEW") ? "VIEW" : "TABLE",
      comment: str(r.COMMENT) || undefined,
      rows: r.ROW_COUNT === null || r.ROW_COUNT === undefined ? null : Number(r.ROW_COUNT),
    })
  }
  return objs
}

async function tableFields(src: { database: string; schema: string; name: string }): Promise<Field[]> {
  const rows = await userQuery(
    `SELECT COLUMN_NAME, DATA_TYPE, NUMERIC_SCALE, COMMENT
       FROM ${quoteIdent(src.database)}.INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
      ORDER BY ORDINAL_POSITION`,
    [src.schema, src.name],
  )
  return rows.map((r) => {
    const dataType = str(r.DATA_TYPE)
    const family = familyOf(dataType)
    const name = str(r.COLUMN_NAME)
    // Numeric columns are measures, except integer "ID/code"-like keys which read better as dimensions.
    const isKey = /(^|_)(ID|CD|COD|CODIGO|KEY|SK|NK|NR|NUM|ANO|MES|YEAR|MONTH)$/i.test(name) && Number(r.NUMERIC_SCALE ?? 0) === 0
    return {
      id: name,
      name,
      role: family === "number" && !isKey ? "measure" : "dimension",
      dataType,
      family,
      description: str(r.COMMENT) || undefined,
    }
  })
}

async function semanticFields(src: Source): Promise<Field[]> {
  const rows = await userQuery(
    `DESCRIBE SEMANTIC VIEW ${[src.database, src.schema, src.name].map(quoteIdent).join(".")}`,
  )
  const byKey = new Map<string, Field>()
  for (const r of rows) {
    const kind = col(r, "object_kind")
    if (kind !== "DIMENSION" && kind !== "METRIC") continue
    const name = col(r, "object_name")
    const entity = col(r, "parent_entity") || undefined
    const id = entity ? `${entity}.${name}` : name
    let f = byKey.get(id)
    if (!f) {
      f = {
        id,
        name,
        entity,
        role: kind === "METRIC" ? "metric" : "dimension",
        dataType: "",
        family: "other",
      }
      byKey.set(id, f)
    }
    const prop = col(r, "property")
    const val = col(r, "property_value")
    if (prop === "DATA_TYPE") {
      f.dataType = val
      f.family = familyOf(val)
    } else if (prop === "COMMENT") {
      f.description = val
    } else if (prop === "ACCESS_MODIFIER" && val === "PRIVATE") {
      byKey.delete(id) // private members cannot be queried
    }
  }
  return [...byKey.values()].sort(
    (a, b) => (a.entity ?? "").localeCompare(b.entity ?? "") || a.name.localeCompare(b.name),
  )
}

async function modelFields(src: Source): Promise<Field[]> {
  const tables = src.model?.tables ?? []
  const perTable = await Promise.all(tables.map((t) => tableFields(t)))
  return perTable.flatMap((cols, i) => {
    const alias = tables[i].alias
    if (cols.length === 0) throw new AppError("e.tableNotFound", { name: tables[i].name })
    return cols.map((c) => ({ ...c, id: `${alias}.${c.name}`, entity: alias }))
  })
}

export async function getFields(src: Source): Promise<Field[]> {
  const fields =
    src.kind === "SEMANTIC_VIEW"
      ? await semanticFields(src)
      : src.kind === "MODEL"
        ? await modelFields(src)
        : await tableFields(src)
  if (fields.length === 0) throw new AppError("e.notFound")
  return fields
}

const ALIAS_RE = /^[A-Z][A-Z0-9_]{0,30}$/

function parseModel(input: unknown): DataModel {
  const m = (input ?? {}) as { tables?: unknown }
  if (!Array.isArray(m.tables) || m.tables.length === 0 || m.tables.length > MAX_MODEL_TABLES) {
    throw new AppError("e.badModel")
  }
  const ok = (v: unknown) => typeof v === "string" && v.length > 0 && v.length <= 255
  const aliases = new Set<string>()
  const tables = m.tables.map((raw, i): ModelTable => {
    const t = raw as Record<string, unknown>
    if (!ok(t.database) || !ok(t.schema) || !ok(t.name)) throw new AppError("e.badModelTable")
    const alias = String(t.alias ?? "")
    if (!ALIAS_RE.test(alias) || aliases.has(alias)) throw new AppError("e.badAlias", { alias })
    const out: ModelTable = { database: t.database as string, schema: t.schema as string, name: t.name as string, alias }
    if (i > 0) {
      const j = (t.join ?? {}) as Record<string, unknown>
      const pairs = Array.isArray(j.pairs) ? j.pairs : []
      if (!aliases.has(String(j.toAlias))) throw new AppError("e.joinUnknown", { alias })
      out.join = {
        toAlias: String(j.toAlias),
        type: j.type === "INNER" ? "INNER" : "LEFT",
        pairs: pairs
          .map((p) => p as Record<string, unknown>)
          .filter((p) => ok(p.left) && ok(p.right))
          .map((p) => ({ left: p.left as string, right: p.right as string })),
      }
    }
    aliases.add(alias)
    return out
  })
  return { tables }
}

export function parseSource(input: unknown): Source {
  const s = (input ?? {}) as Record<string, unknown>
  const kind = s.kind
  if (kind !== "TABLE" && kind !== "VIEW" && kind !== "SEMANTIC_VIEW" && kind !== "MODEL") throw new AppError("e.badKind")
  for (const k of ["database", "schema", "name"] as const) {
    if (typeof s[k] !== "string" || !(s[k] as string).length || (s[k] as string).length > 255) {
      throw new AppError("e.badParam", { name: k })
    }
  }
  const src: Source = { database: s.database as string, schema: s.schema as string, name: s.name as string, kind }
  if (kind === "MODEL") src.model = parseModel(s.model)
  if (s.calcs !== undefined) src.calcs = parseCalcs(s.calcs)
  if (s.folders !== undefined) src.folders = parseFolders(s.folders)
  return src
}

const CALC_ID_RE = /^[A-Za-z0-9_-]{1,40}$/

function parseCalcs(input: unknown): CalcMetric[] {
  if (!Array.isArray(input) || input.length > MAX_CALCS) throw new AppError("e.badCalc")
  const ids = new Set<string>()
  return input.map((raw) => {
    const c = (raw ?? {}) as Record<string, unknown>
    const id = String(c.id ?? "")
    const name = typeof c.name === "string" ? c.name.trim().slice(0, 100) : ""
    const formula = typeof c.formula === "string" ? c.formula.slice(0, 2000) : ""
    if (!CALC_ID_RE.test(id) || ids.has(id) || !name || !formula.trim()) throw new AppError("e.badCalc")
    ids.add(id)
    const format: CalcFormat = c.format === "percent" || c.format === "currency" ? c.format : "number"
    const decimals = Math.min(Math.max(Math.trunc(Number(c.decimals ?? 2)) || 0, 0), 6)
    const currency = (CURRENCIES as readonly string[]).includes(String(c.currency)) ? String(c.currency) : "BRL"
    return { id, name, formula, format, decimals, ...(format === "currency" ? { currency } : {}) }
  })
}

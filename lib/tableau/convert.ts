/**
 * Tableau workbook → SnowDash Source (MODEL) + sheets. Pure: no Snowflake access.
 * Everything that cannot be mapped is reported as a warning instead of failing.
 */

import { AppError } from "../i18n/messages"
import { parseFormula, AGG_FUNCS, type Node } from "../pivot/formula"
import { makeAlias } from "../pivot/model"
import {
  CALC_PREFIX,
  COUNT_ROWS_ID,
  DEFAULT_LIMIT,
  MAX_CALCS,
  MAX_FOLDERS,
  MAX_FOLDER_FIELDS,
  MAX_MODEL_TABLES,
  type Agg,
  type CalcMetric,
  type DimRef,
  type FieldFolder,
  type FilterRef,
  type Grain,
  type KeyCast,
  type ModelTable,
  type PivotSpec,
  type Source,
  type ValueRef,
} from "../pivot/types"
import { splitBrackets, type TwbColumn, type TwbDatasource, type TwbFilter, type TwbWorkbook, type TwbWorksheet } from "./twb"

export interface ImportWarning {
  /** i18n key suffix: tb.w.<code> */
  code: string
  vars?: Record<string, string | number>
}

export interface ImportedSheet {
  id: string
  name: string
  spec: PivotSpec
  view: "table" | "chart"
  chartKind: "bar" | "line" | "area"
  heatmap: boolean
}

export interface Remap {
  /** Database name replacements (case-insensitive key). */
  database?: Record<string, string>
  schema?: Record<string, string>
}

export interface ConvertOptions {
  datasource?: string
  remap?: Remap
  uuid?: () => string
}

export interface ImportResult {
  datasources: { name: string; caption: string; tables: number }[]
  datasource: string
  source: Source
  sheets: ImportedSheet[]
  warehouse: string | null
  warnings: ImportWarning[]
}

const unbr = (s: string) => splitBrackets(s)[0] ?? s
const br = (s: string) => (s.startsWith("[") ? s : `[${s}]`)

function remapName(map: Record<string, string> | undefined, v: string): string {
  if (!map) return v
  const hit = Object.entries(map).find(([k]) => k.toUpperCase() === v.toUpperCase())
  return hit && hit[1].trim() ? hit[1].trim() : v
}

// ---------------------------------------------------------------------------
// Field instances (`deriv:Name:suffix`)
// ---------------------------------------------------------------------------

export interface Instance {
  deriv: string
  name: string
  special?: "measureNames" | "measureValues" | "multiple" | "objectCount"
}

export function parseInstance(inst: string): Instance {
  if (inst === ":Measure Names") return { deriv: "", name: "", special: "measureNames" }
  if (inst === "Multiple Values" || inst === ":Measure Values") return { deriv: "", name: "", special: "measureValues" }
  const first = inst.indexOf(":")
  const last = inst.lastIndexOf(":")
  if (first < 0 || first === last) return { deriv: "none", name: inst }
  const deriv = inst.slice(0, first)
  const name = inst.slice(first + 1, last)
  return { deriv, name }
}

const GRAIN_OF: Record<string, Grain> = {
  tdy: "day", dy: "day", md: "day",
  twk: "week", wk: "week",
  tmn: "month", mn: "month", my: "month",
  tqr: "quarter", qr: "quarter",
  tyr: "year", yr: "year",
}
const AGG_OF: Record<string, Agg> = {
  sum: "SUM", avg: "AVG", min: "MIN", max: "MAX", cnt: "COUNT", ctd: "COUNT_DISTINCT",
}

/** Tableau literal (`"PPL"`, `#2026-09-30#`, `12`) → filter value. */
export function literal(m: string): string | number | null {
  const s = m.trim()
  if (s === "%null%" || s === "") return null
  const d = /^#(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2}))?#$/.exec(s)
  if (d) return d[2] && d[2] !== "00:00:00" ? `${d[1]} ${d[2]}` : d[1]
  const q = /^"((?:[^"]|"")*)"$/.exec(s)
  if (q) return q[1].replace(/""/g, '"')
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  return s
}

function addPeriod(date: string, grain: Grain): string {
  const [y, m, dd] = date.slice(0, 10).split("-").map(Number)
  const d = new Date(Date.UTC(y, m - 1, dd))
  if (grain === "year") d.setUTCFullYear(d.getUTCFullYear() + 1)
  else if (grain === "quarter") d.setUTCMonth(d.getUTCMonth() + 3)
  else if (grain === "month") d.setUTCMonth(d.getUTCMonth() + 1)
  else if (grain === "week") d.setUTCDate(d.getUTCDate() + 7)
  else d.setUTCDate(d.getUTCDate() + 1)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Calculated fields
// ---------------------------------------------------------------------------

/** Replace `FN(args)` with `fmt(args)` handling nested parentheses. */
function rewriteCall(src: string, fn: string, fmt: (inner: string) => string): string {
  const re = new RegExp(`\\b${fn}\\s*\\(`, "i")
  let out = src
  for (let guard = 0; guard < 50; guard++) {
    const m = re.exec(out)
    if (!m) break
    let depth = 1
    let j = m.index + m[0].length
    for (; j < out.length && depth; j++) {
      if (out[j] === "(") depth++
      else if (out[j] === ")") depth--
    }
    if (depth) break
    out = out.slice(0, m.index) + fmt(out.slice(m.index + m[0].length, j - 1)) + out.slice(j)
  }
  return out
}

function hasAgg(n: Node): boolean {
  if (n.t === "call") return (AGG_FUNCS as readonly string[]).includes(n.fn) || n.args.some(hasAgg)
  if (n.t === "bin") return hasAgg(n.l) || hasAgg(n.r)
  if (n.t === "neg" || n.t === "not") return hasAgg(n.e)
  return false
}

export type CalcOutcome = { ok: true; formula: string } | { ok: false; reason: string }

/**
 * Translate a Tableau formula into SnowDash's formula grammar.
 * Only aggregate formulas (SUM/AVG/…/COUNTD with IF/IIF/ZN/arith) are supported.
 */
export function translateFormula(formula: string, resolve: (local: string) => string | null): CalcOutcome {
  let f = formula.replace(/\/\/.*$/gm, "").trim()
  if (!f) return { ok: false, reason: "empty" }
  if (/\{\s*(FIXED|INCLUDE|EXCLUDE)?/i.test(f)) return { ok: false, reason: "lod" }
  if (/\[Parameters\]/i.test(f)) return { ok: false, reason: "parameter" }
  if (/\b(WINDOW_\w+|RUNNING_\w+|LOOKUP|INDEX|RANK\w*|TOTAL|SIZE|FIRST|LAST|PREVIOUS_VALUE)\s*\(/i.test(f)) {
    return { ok: false, reason: "tableCalc" }
  }
  // Field references → SnowDash ids (two-part [ds].[x] keeps the last part).
  let missing: string | null = null
  f = f.replace(/\[((?:[^\]]|\]\])+)\](?:\.\[((?:[^\]]|\]\])+)\])?/g, (_m, a: string, b?: string) => {
    const local = br((b ?? a).replace(/\]\]/g, "]"))
    const id = resolve(local)
    if (!id) {
      missing ??= unbr(local)
      return "[?]"
    }
    return `[${id}]`
  })
  if (missing) return { ok: false, reason: `field:${missing}` }
  // Strings: Tableau accepts "…"; SnowDash only '…'.
  f = f.replace(/"((?:[^"]|"")*)"/g, (_m, s: string) => `'${s.replace(/""/g, '"').replace(/'/g, "''")}'`)
  f = f.replace(/\bCOUNTD\s*\(/gi, "COUNT_DISTINCT(").replace(/\bIIF\s*\(/gi, "IF(").replace(/==/g, "=")
  f = rewriteCall(f, "ZN", (inner) => `COALESCE(${inner}, 0)`)
  const ifm = /^\s*IF\s+([\s\S]+?)\s+THEN\s+([\s\S]+?)\s+(?:ELSE\s+([\s\S]+?)\s+)?END\s*$/i.exec(f)
  if (ifm) {
    if (/\bELSEIF\b/i.test(f)) return { ok: false, reason: "syntax" }
    f = `IF(${ifm[1]}, ${ifm[2]}, ${ifm[3] ?? "NULL"})`
  }
  f = f.replace(/\s+/g, " ").trim()
  let ast: Node
  try {
    ast = parseFormula(f)
  } catch {
    return { ok: false, reason: "syntax" }
  }
  if (!hasAgg(ast)) return { ok: false, reason: "rowLevel" }
  return { ok: true, formula: f }
}

// ---------------------------------------------------------------------------
// Datasource → Source
// ---------------------------------------------------------------------------

interface Ctx {
  ds: TwbDatasource
  /** Tableau local name `[X]` → SnowDash field id (ALIAS.REMOTE or calc:<id>). */
  fieldOf: (local: string) => string | null
  /** Local name → Tableau role (dimension/measure) */
  roleOf: (local: string) => string | undefined
  calcLocal: Map<string, string>
  skippedCalcs: Set<string>
  aliasOf: Map<string, string>
  warnings: ImportWarning[]
  objectCountAlias: (objectId: string) => string | null
}

function calcIdFor(local: string, taken: Set<string>): string {
  const base = ("tb_" + unbr(local).replace(/^Calculation_/i, "").replace(/[^A-Za-z0-9_-]/g, "_")).slice(0, 36)
  let id = base
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`
  taken.add(id)
  return id
}

function calcFormat(c: TwbColumn): Pick<CalcMetric, "format" | "decimals" | "currency"> {
  return c.datatype === "integer" ? { format: "number", decimals: 0 } : { format: "number", decimals: 2 }
}

/** Tableau type-conversion functions allowed on relationship keys. */
const CAST_OF: Record<string, KeyCast> = { INT: "number", FLOAT: "number", STR: "string", DATE: "date", DATETIME: "date" }

interface Edge {
  a: string
  b: string
  pairs: { a: string; b: string; aCast?: KeyCast; bCast?: KeyCast }[]
  type: "LEFT" | "INNER"
}

function buildModel(ds: TwbDatasource, remap: Remap | undefined, warnings: ImportWarning[]) {
  const objById = new Map(ds.objects.map((o) => [o.id, o]))
  const objByRelation = new Map(ds.objects.map((o) => [o.relation, o]))
  const colByLocal = new Map(ds.columns.map((c) => [c.local, c]))

  /** Expression operand → { objectId, column, cast } */
  const operand = (expr: string): { obj: string; col: string; cast?: KeyCast } | null => {
    const fnWrapped = /^\s*([A-Za-z_]+)\s*\(\s*(\[[\s\S]*\])\s*\)\s*$/.exec(expr)
    const e = fnWrapped ? fnWrapped[2] : expr
    const cast = fnWrapped ? CAST_OF[fnWrapped[1].toUpperCase()] : undefined
    if (fnWrapped && !cast) warnings.push({ code: "keyFunc", vars: { expr } })
    const parts = splitBrackets(e)
    if (parts.length >= 2 && objByRelation.has(parts[parts.length - 2])) {
      return { obj: objByRelation.get(parts[parts.length - 2])!.id, col: parts[parts.length - 1], cast }
    }
    const c = colByLocal.get(br(parts[parts.length - 1] ?? ""))
    if (!c?.remote) return null
    const o = (c.objectId && objById.get(c.objectId)) || (c.relation && objByRelation.get(c.relation))
    return o ? { obj: o.id, col: c.remote, cast } : null
  }

  const edges: Edge[] = []
  for (const r of ds.relationships) {
    const pairs: Edge["pairs"] = []
    let a = r.first
    let b = r.second
    for (const p of r.pairs) {
      const l = operand(p.left)
      const rr = operand(p.right)
      if (!l || !rr) {
        warnings.push({ code: "keyUnresolved", vars: { expr: `${p.left} = ${p.right}` } })
        continue
      }
      if (!a || !b) {
        a ||= l.obj
        b ||= rr.obj
      }
      // Orient each pair to (a, b).
      if (l.obj === a && rr.obj === b) pairs.push({ a: l.col, b: rr.col, aCast: l.cast, bCast: rr.cast })
      else if (l.obj === b && rr.obj === a) pairs.push({ a: rr.col, b: l.col, aCast: rr.cast, bCast: l.cast })
      else warnings.push({ code: "keyUnresolved", vars: { expr: `${p.left} = ${p.right}` } })
    }
    const jt = (r.joinType ?? "").toLowerCase()
    if (jt === "right" || jt === "full") warnings.push({ code: "joinType", vars: { type: jt.toUpperCase() } })
    if (a && b && pairs.length) edges.push({ a, b, pairs, type: jt === "inner" ? "INNER" : "LEFT" })
  }

  // Root: the object that is most often the "first" side (fact table), else the first object.
  const score = new Map<string, number>()
  edges.forEach((e) => score.set(e.a, (score.get(e.a) ?? 0) + 1))
  const root = [...score.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? ds.objects[0]?.id
  if (!root) throw new AppError("tb.noTables")

  const aliasOf = new Map<string, string>()
  const tables: ModelTable[] = []
  const add = (id: string, join?: ModelTable["join"]) => {
    const o = objById.get(id)!
    const alias = makeAlias(o.table, [...aliasOf.values()])
    aliasOf.set(id, alias)
    tables.push({
      database: remapName(remap?.database, o.database),
      schema: remapName(remap?.schema, o.schema),
      name: o.table,
      alias,
      ...(join ? { join } : {}),
    })
  }
  add(root)
  const used = new Set<Edge>()
  for (let grew = true; grew; ) {
    grew = false
    for (const e of edges) {
      if (used.has(e)) continue
      const inA = aliasOf.has(e.a)
      const inB = aliasOf.has(e.b)
      if (inA && inB) {
        used.add(e)
        warnings.push({ code: "cycle", vars: { a: objById.get(e.a)?.table ?? e.a, b: objById.get(e.b)?.table ?? e.b } })
        continue
      }
      if (!inA && !inB) continue
      if (tables.length >= MAX_MODEL_TABLES) continue
      used.add(e)
      grew = true
      const pair = (left: string, right: string, lc?: KeyCast, rc?: KeyCast) => ({
        left,
        right,
        ...(lc ? { leftCast: lc } : {}),
        ...(rc ? { rightCast: rc } : {}),
      })
      const [parent, child, pairs] = inA
        ? [e.a, e.b, e.pairs.map((p) => pair(p.a, p.b, p.aCast, p.bCast))]
        : [e.b, e.a, e.pairs.map((p) => pair(p.b, p.a, p.bCast, p.aCast))]
      add(child, { toAlias: aliasOf.get(parent)!, type: e.type, pairs })
    }
  }
  for (const o of ds.objects) {
    if (aliasOf.has(o.id)) continue
    warnings.push({ code: tables.length >= MAX_MODEL_TABLES ? "maxTables" : "unlinked", vars: { name: o.table, n: MAX_MODEL_TABLES } })
  }
  return { tables, aliasOf, objById, objByRelation }
}

function convertDatasource(wb: TwbWorkbook, ds: TwbDatasource, opts: ConvertOptions) {
  const warnings: ImportWarning[] = []
  if (ds.connectionClass && ds.connectionClass !== "snowflake") {
    warnings.push({ code: "notSnowflake", vars: { cls: ds.connectionClass } })
  }
  for (const s of ds.customSql) warnings.push({ code: "customSql", vars: { name: s.split(":")[0] } })
  if (!ds.objects.length) throw new AppError("tb.noTables")

  const { tables, aliasOf, objById, objByRelation } = buildModel(ds, opts.remap, warnings)
  const colByLocal = new Map(ds.columns.map((c) => [c.local, c]))

  const physical = (local: string): string | null => {
    const c = colByLocal.get(local)
    if (!c?.remote) return null
    const o = (c.objectId && objById.get(c.objectId)) || (c.relation && objByRelation.get(c.relation))
    const alias = o && aliasOf.get(o.id)
    return alias ? `${alias}.${c.remote}` : null
  }

  // Calculated fields: datasource-level plus worksheet-local ones.
  const calcCols = [...ds.columns.filter((c) => c.formula)]
  for (const w of wb.worksheets) {
    if (w.datasource !== ds.name) continue
    for (const c of w.columns) if (!calcCols.some((x) => x.local === c.local)) calcCols.push(c)
  }
  const calcLocal = new Map<string, string>()
  const skippedCalcs = new Set<string>()
  const calcs: CalcMetric[] = []
  const takenIds = new Set<string>()
  for (const c of calcCols) {
    const name = c.caption || unbr(c.local)
    if (calcs.length >= MAX_CALCS) {
      warnings.push({ code: "calcSkipped", vars: { name, reason: "max" } })
      skippedCalcs.add(c.local)
      continue
    }
    const r = translateFormula(c.formula!, physical)
    if (!r.ok) {
      warnings.push({ code: "calcSkipped", vars: { name, reason: r.reason, formula: c.formula!.slice(0, 300) } })
      skippedCalcs.add(c.local)
      continue
    }
    const id = calcIdFor(c.local, takenIds)
    calcs.push({ id, name: name.slice(0, 100), formula: r.formula, ...calcFormat(c) })
    calcLocal.set(c.local, CALC_PREFIX + id)
  }

  const ctx: Ctx = {
    ds,
    fieldOf: (local) => calcLocal.get(local) ?? physical(local),
    roleOf: (local) => colByLocal.get(local)?.role,
    calcLocal,
    skippedCalcs,
    aliasOf,
    warnings,
    objectCountAlias: (id) => aliasOf.get(id) ?? null,
  }

  // Labels / hidden / roles.
  const labels: Record<string, string> = {}
  const hidden: string[] = []
  const roles: Record<string, "dimension" | "measure"> = {}
  for (const c of ds.columns) {
    const id = physical(c.local)
    if (!id) continue
    const remote = id.slice(id.indexOf(".") + 1)
    const display = c.caption || unbr(c.local)
    if (display && display !== remote) labels[id] = display
    if (c.hidden) hidden.push(id)
    if (c.role === "dimension" || c.role === "measure") roles[id] = c.role
  }

  // Folders.
  const folders: FieldFolder[] = []
  const placed = new Set<string>()
  let unresolved = 0
  for (const [i, f] of ds.folders.entries()) {
    if (folders.length >= MAX_FOLDERS) break
    const fieldIds: string[] = []
    for (const item of f.items) {
      const id = ctx.fieldOf(item)
      if (!id) {
        unresolved++
        continue
      }
      if (placed.has(id) || fieldIds.length >= MAX_FOLDER_FIELDS) continue
      placed.add(id)
      fieldIds.push(id)
    }
    if (fieldIds.length) folders.push({ id: `tb${i + 1}`, name: f.name.slice(0, 100) || `Folder ${i + 1}`, fieldIds })
  }
  if (unresolved) warnings.push({ code: "folderItems", vars: { n: unresolved } })

  const base = tables[0]
  const source: Source = {
    database: base.database,
    schema: base.schema,
    name: base.name,
    kind: "MODEL",
    model: { tables },
    ...(calcs.length ? { calcs } : {}),
    ...(folders.length ? { folders } : {}),
    ...(Object.keys(labels).length ? { labels } : {}),
    ...(hidden.length ? { hidden } : {}),
    ...(Object.keys(roles).length ? { roles } : {}),
  }
  return { source, ctx, warnings }
}

// ---------------------------------------------------------------------------
// Worksheets → sheets
// ---------------------------------------------------------------------------

function instanceField(ctx: Ctx, inst: Instance): string | null {
  if (inst.name.startsWith("__tableau_internal_object_id__")) return COUNT_ROWS_ID
  return ctx.fieldOf(br(inst.name))
}

function convertWorksheet(ctx: Ctx, w: TwbWorksheet, uuid: () => string): ImportedSheet {
  const warn = (code: string, vars: Record<string, string | number> = {}) => ctx.warnings.push({ code, vars: { sheet: w.name, ...vars } })
  const rows: DimRef[] = []
  const columns: DimRef[] = []
  const values: ValueRef[] = []
  const filters: FilterRef[] = []
  const valueKey = new Set<string>()

  const pushValue = (instRaw: string) => {
    const inst = parseInstance(instRaw)
    if (inst.special) return
    // Object counts look like cnt:<object id>:qk.
    if (inst.deriv === "cnt" && ctx.objectCountAlias(inst.name)) {
      if (!valueKey.has(COUNT_ROWS_ID)) values.push({ fieldId: COUNT_ROWS_ID, agg: "COUNT" })
      valueKey.add(COUNT_ROWS_ID)
      return
    }
    const id = instanceField(ctx, inst)
    if (!id) {
      warn(ctx.skippedCalcs.has(br(inst.name)) ? "calcRef" : "fieldMissing", { name: inst.name })
      return
    }
    const agg: Agg | undefined = id.startsWith(CALC_PREFIX) ? "CALC" : id === COUNT_ROWS_ID ? "COUNT" : AGG_OF[inst.deriv]
    if (!agg) {
      warn("aggUnsupported", { name: inst.name, agg: inst.deriv })
      return
    }
    const key = `${id}|${agg}`
    if (valueKey.has(key)) return
    valueKey.add(key)
    values.push({ fieldId: id, agg })
  }

  const axis = (tokens: string[], out: DimRef[]) => {
    for (const raw of tokens) {
      const inst = parseInstance(raw)
      if (inst.special) continue
      if (AGG_OF[inst.deriv] || inst.deriv === "usr") {
        pushValue(raw)
        continue
      }
      const id = instanceField(ctx, inst)
      if (!id || id.startsWith(CALC_PREFIX)) {
        warn(ctx.skippedCalcs.has(br(inst.name)) || id?.startsWith(CALC_PREFIX) ? "calcDim" : "fieldMissing", { name: inst.name })
        continue
      }
      if (out.some((d) => d.fieldId === id) || rows.some((d) => d.fieldId === id) || columns.some((d) => d.fieldId === id)) continue
      const grain = GRAIN_OF[inst.deriv]
      out.push(grain ? { fieldId: id, grain } : { fieldId: id })
    }
  }
  axis(w.rows, rows)
  axis(w.cols, columns)
  w.measureNames.forEach(pushValue)
  w.encodings.forEach(pushValue)

  for (const f of w.filters) filters.push(...convertFilter(ctx, f, warn))

  const mark = w.mark.toLowerCase()
  const chartKind = mark === "line" ? "line" : mark === "area" ? "area" : "bar"
  const view = mark === "bar" || mark === "line" || mark === "area" ? "chart" : "table"
  return {
    id: uuid(),
    name: w.name.slice(0, 100) || "Sheet",
    spec: { rows, columns, values, filters, totals: w.rowTotal || w.colTotal, subtotals: false, limit: DEFAULT_LIMIT },
    view,
    chartKind,
    heatmap: false,
  }
}

function convertFilter(ctx: Ctx, f: TwbFilter, warn: (code: string, vars?: Record<string, string | number>) => void): FilterRef[] {
  const inst = parseInstance(f.column)
  const objAlias = inst.deriv === "cnt" ? ctx.objectCountAlias(inst.name) : null
  const label = objAlias ? `COUNT(${objAlias})` : inst.name || f.column
  if (f.cls === "relative-date") {
    warn("filterRelative", { name: label })
    return []
  }
  if (objAlias || AGG_OF[inst.deriv] || inst.name.startsWith("__tableau_internal_object_id__")) {
    warn("filterAgg", { name: label })
    return []
  }
  const id = instanceField(ctx, inst)
  if (!id || id.startsWith(CALC_PREFIX)) {
    warn(ctx.skippedCalcs.has(br(inst.name)) || id?.startsWith(CALC_PREFIX) ? "filterCalc" : "fieldMissing", { name: label })
    return []
  }
  if (f.cls === "quantitative") {
    const min = f.min !== undefined ? literal(f.min) : null
    const max = f.max !== undefined ? literal(f.max) : null
    if (min !== null && max !== null) return [{ fieldId: id, op: "between", values: [min, max] }]
    if (min !== null) return [{ fieldId: id, op: "gte", values: [min] }]
    if (max !== null) return [{ fieldId: id, op: "lte", values: [max] }]
    return []
  }
  const vals = f.members.map(literal)
  const hasNull = vals.some((v) => v === null)
  const clean = vals.filter((v): v is string | number => v !== null)
  if (hasNull) warn("filterNull", { name: label })
  if (!clean.length) {
    if (f.members.length || f.exclude) warn("filterSkipped", { name: label })
    return []
  }
  // Truncated-date members (months, years…) become a date range.
  const grain = GRAIN_OF[inst.deriv]
  if (grain && grain !== "day" && inst.deriv.startsWith("t") && clean.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v))) {
    const sorted = (clean as string[]).map((v) => v.slice(0, 10)).sort()
    warn("filterDateRange", { name: label, from: sorted[0], to: addPeriod(sorted[sorted.length - 1], grain) })
    return [{ fieldId: id, op: f.exclude ? "not_in" : "between", values: f.exclude ? sorted : [sorted[0], addPeriod(sorted[sorted.length - 1], grain)] }]
  }
  return [{ fieldId: id, op: f.exclude ? "not_in" : "in", values: clean.slice(0, 1000) }]
}

// ---------------------------------------------------------------------------

export function convertWorkbook(wb: TwbWorkbook, opts: ConvertOptions = {}): ImportResult {
  const uuid = opts.uuid ?? (() => crypto.randomUUID())
  const usable = wb.datasources.filter((d) => d.objects.length)
  if (!usable.length) throw new AppError("tb.noTables")
  const ds = (opts.datasource && usable.find((d) => d.name === opts.datasource)) || usable[0]
  const { source, ctx, warnings } = convertDatasource(wb, ds, opts)
  const sheets = wb.worksheets.filter((w) => w.datasource === ds.name).map((w) => convertWorksheet(ctx, w, uuid))
  const others = wb.worksheets.filter((w) => w.datasource !== ds.name && w.datasource !== "Parameters")
  if (others.length) warnings.push({ code: "otherSheets", vars: { n: others.length } })
  return {
    datasources: usable.map((d) => ({ name: d.name, caption: d.caption, tables: d.objects.length })),
    datasource: ds.name,
    source,
    sheets,
    warehouse: ds.warehouse || null,
    warnings,
  }
}

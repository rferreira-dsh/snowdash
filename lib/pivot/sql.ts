/**
 * Pure SQL builder for pivot queries (no Snowflake I/O — unit-testable).
 *
 * Safety model:
 *  - Every identifier comes from catalog metadata (fields are looked up by id
 *    against the source's real columns / semantic-view members) and is quoted
 *    with quoteIdent, which doubles embedded quotes.
 *  - Aggregations, grains and filter operators are whitelisted enums.
 *  - Every user-supplied filter value is passed as a bind (`?`).
 */

import {
  CALC_PREFIX,
  COUNT_ROWS_ID,
  GRAINS,
  MAX_LIMIT,
  TABLE_AGGS,
  type CalcMetric,
  type DimRef,
  type Field,
  type FilterRef,
  type PivotSpec,
  type Source,
} from "./types"
import { AppError } from "../i18n/messages"
import { formulaFields, parseFormula, renderMetricsFormula, renderTableFormula } from "./formula"

export type Bind = string | number

export class PivotError extends AppError {}

/** Calculated metric for a `calc:<id>` field id (must be defined on the source). */
function findCalc(src: Source, fieldId: string): CalcMetric {
  const id = fieldId.slice(CALC_PREFIX.length)
  const c = src.calcs?.find((x) => x.id === id)
  if (!c) throw new PivotError("e.calcUnknown", { id })
  return c
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`
}

export function sourceFqn(src: Source): string {
  return [src.database, src.schema, src.name].map(quoteIdent).join(".")
}

/** Column reference for tables/views/models: "ALIAS"."COL" inside a model, "COL" otherwise. */
function colRef(f: Field): string {
  return f.entity ? `${quoteIdent(f.entity)}.${quoteIdent(f.name)}` : quoteIdent(f.name)
}

/** FROM clause; for a data model renders the join tree with validated keys. */
export function fromClause(src: Source, fields: Field[]): string {
  if (src.kind !== "MODEL") return sourceFqn(src)
  const tables = src.model?.tables ?? []
  if (tables.length === 0) throw new PivotError("e.modelEmpty")
  const map = fieldMap(fields)
  const seen = new Set<string>()
  const parts: string[] = []
  tables.forEach((t, i) => {
    const fqn = `${[t.database, t.schema, t.name].map(quoteIdent).join(".")} AS ${quoteIdent(t.alias)}`
    if (i === 0) {
      parts.push(fqn)
    } else {
      const j = t.join
      if (!j || !seen.has(j.toAlias)) throw new PivotError("e.badJoin", { alias: t.alias })
      if (j.type !== "LEFT" && j.type !== "INNER") throw new PivotError("e.badJoinType")
      if (!j.pairs.length) throw new PivotError("e.joinKeys", { alias: t.alias })
      const on = j.pairs.map((p) => {
        const l = lookup(map, `${j.toAlias}.${p.left}`)
        const r = lookup(map, `${t.alias}.${p.right}`)
        return `${colRef(l)} = ${colRef(r)}`
      })
      parts.push(`${j.type} JOIN ${fqn} ON ${on.join(" AND ")}`)
    }
    seen.add(t.alias)
  })
  return parts.join("\n")
}

function fieldMap(fields: Field[]): Map<string, Field> {
  return new Map(fields.map((f) => [f.id, f]))
}

function lookup(map: Map<string, Field>, id: string): Field {
  const f = map.get(id)
  if (!f) throw new PivotError("e.unknownField", { id })
  return f
}

/** Semantic-view member reference: "ENTITY"."NAME". */
function svRef(f: Field): string {
  return f.entity ? `${quoteIdent(f.entity)}.${quoteIdent(f.name)}` : quoteIdent(f.name)
}

/** ISO strings from the JSON boundary → Snowflake-friendly literals for DATE/TIMESTAMP comparison. */
export function normalizeBind(v: Bind, f: Field): Bind {
  if (f.family !== "date" || typeof v !== "string") return v
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d+)?Z$/.exec(v)
  if (!m) return v
  return m[2] === "00:00:00" ? m[1] : `${m[1]} ${m[2]}${m[3] ?? ""}`
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit <= 0) return 1000
  return Math.min(Math.floor(limit), MAX_LIMIT)
}

/** WHERE predicates; `col` renders the field reference for the dialect in use. */
function buildFilters(
  filters: FilterRef[],
  map: Map<string, Field>,
  col: (f: Field) => string,
  binds: Bind[],
  allowMetric: boolean,
): string[] {
  const out: string[] = []
  for (const flt of filters) {
    const f = lookup(map, flt.fieldId)
    if (f.role === "metric" && !allowMetric) {
      throw new PivotError("e.filterDimsOnly", { name: f.name })
    }
    const c = col(f)
    const vals = (flt.values ?? [])
      .filter((v) => v !== "" && v !== null && v !== undefined)
      .map((v) => normalizeBind(v, f))
    const need = (n: number) => {
      if (vals.length < n) throw new PivotError("e.filterNoValue", { name: f.name })
    }
    switch (flt.op) {
      case "is_null":
        out.push(`${c} IS NULL`)
        break
      case "not_null":
        out.push(`${c} IS NOT NULL`)
        break
      case "in":
      case "not_in": {
        if (vals.length === 0) continue // empty selection = no filter
        binds.push(...vals)
        const ph = vals.map(() => "?").join(", ")
        out.push(`${c} ${flt.op === "in" ? "IN" : "NOT IN"} (${ph})`)
        break
      }
      case "contains":
        need(1)
        binds.push(`%${String(vals[0])}%`)
        out.push(`${c}::VARCHAR ILIKE ?`)
        break
      case "between":
        need(2)
        binds.push(vals[0], vals[1])
        out.push(`${c} BETWEEN ? AND ?`)
        break
      case "eq":
      case "neq":
      case "gt":
      case "gte":
      case "lt":
      case "lte": {
        need(1)
        const sym = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[flt.op]
        binds.push(vals[0])
        out.push(`${c} ${sym} ?`)
        break
      }
      default:
        throw new PivotError("e.badOp", { op: String(flt.op) })
    }
  }
  return out
}

function validateSpec(spec: PivotSpec) {
  if (spec.rows.length + spec.columns.length + spec.values.length === 0) {
    throw new PivotError("e.needField")
  }
  if (spec.rows.length > 8 || spec.columns.length > 4 || spec.values.length > 12) {
    throw new PivotError("e.tooMany")
  }
}

/** Depths (number of leading dims kept) per axis needed for totals/subtotals. */
function axisDepths(n: number, spec: PivotSpec): number[] {
  const out = [n]
  if (spec.values.length === 0) return out
  if (spec.subtotals) for (let d = n - 1; d >= 1; d--) out.push(d)
  if (spec.totals && n > 0) out.push(0)
  return out
}

/** Distinct grouping sets as [rowDepth, colDepth]; the first one is the detail level. */
function groupingSets(spec: PivotSpec): [number, number][] {
  const sets: [number, number][] = []
  for (const r of axisDepths(spec.rows.length, spec)) {
    for (const c of axisDepths(spec.columns.length, spec)) sets.push([r, c])
  }
  return sets
}

/** Number of rolled-up dims (0 = detail) — sum of GROUPING() per dim. */
function groupingLevel(exprs: string[]): string {
  if (exprs.length === 0) return "0"
  if (exprs.length === 1) return `GROUPING(${exprs[0]})`
  return `(${exprs.map((e) => `GROUPING(${e})`).join(" + ")})`
}

// ---------------------------------------------------------------------------
// Tables / views
// ---------------------------------------------------------------------------

function tableDimExpr(f: Field, ref: DimRef): string {
  const c = colRef(f)
  if (ref.grain) {
    if (!GRAINS.includes(ref.grain)) throw new PivotError("e.badGrain", { grain: String(ref.grain) })
    if (f.family !== "date") throw new PivotError("e.notDate", { name: f.name })
    return `DATE_TRUNC('${ref.grain.toUpperCase()}', ${c})`
  }
  return c
}

function tableAggExpr(src: Source, fields: Field[], map: Map<string, Field>, fieldId: string, agg: string): string {
  if (fieldId === COUNT_ROWS_ID) return "COUNT(*)"
  if (fieldId.startsWith(CALC_PREFIX)) {
    return renderTableFormula(parseFormula(findCalc(src, fieldId).formula), fields, colRef)
  }
  const f = lookup(map, fieldId)
  if (!TABLE_AGGS.includes(agg as never)) throw new PivotError("e.badAgg", { agg: String(agg) })
  if ((agg === "SUM" || agg === "AVG") && f.family !== "number") {
    throw new PivotError("e.needNumber", { agg, name: f.name })
  }
  const c = colRef(f)
  return agg === "COUNT_DISTINCT" ? `COUNT(DISTINCT ${c})` : `${agg}(${c})`
}

export function buildTableQuery(src: Source, fields: Field[], spec: PivotSpec) {
  validateSpec(spec)
  const map = fieldMap(fields)
  const binds: Bind[] = []

  const rowExprs = spec.rows.map((d) => tableDimExpr(lookup(map, d.fieldId), d))
  const colExprs = spec.columns.map((d) => tableDimExpr(lookup(map, d.fieldId), d))
  const valExprs = spec.values.map((v) => tableAggExpr(src, fields, map, v.fieldId, v.agg))

  const select: string[] = [
    ...rowExprs.map((e, i) => `${e} AS "r${i}"`),
    ...colExprs.map((e, i) => `${e} AS "c${i}"`),
    ...valExprs.map((e, i) => `${e} AS "v${i}"`),
  ]

  const sets = groupingSets(spec)
  const useSets = sets.length > 1
  if (useSets) {
    select.push(`${groupingLevel(rowExprs)} AS "__gr"`)
    select.push(`${groupingLevel(colExprs)} AS "__gc"`)
  } else {
    select.push(`0 AS "__gr"`, `0 AS "__gc"`)
  }

  const where = buildFilters(spec.filters, map, colRef, binds, true)
  const dims = [...rowExprs, ...colExprs]

  let groupBy = ""
  if (dims.length && valExprs.length) {
    if (useSets) {
      const parts = sets.map(([r, c]) => `(${[...rowExprs.slice(0, r), ...colExprs.slice(0, c)].join(", ")})`)
      groupBy = `GROUP BY GROUPING SETS (${parts.join(", ")})`
    } else {
      groupBy = `GROUP BY ${dims.join(", ")}`
    }
  } else if (dims.length) {
    groupBy = `GROUP BY ${dims.join(", ")}`
  }

  const limit = clampLimit(spec.limit)
  const order = ['"__gr"', '"__gc"', ...dims.map((_, i) => String(i + 1))]
  const sql = [
    `SELECT ${select.join(",\n       ")}`,
    `FROM ${fromClause(src, fields)}`,
    where.length ? `WHERE ${where.join("\n  AND ")}` : "",
    groupBy,
    `ORDER BY ${order.join(", ")}`,
    `LIMIT ${limit + 1}`,
  ]
    .filter(Boolean)
    .join("\n")

  return { sql, binds, limit }
}

// ---------------------------------------------------------------------------
// Semantic views
// ---------------------------------------------------------------------------

export function buildSemanticQuery(src: Source, fields: Field[], spec: PivotSpec) {
  validateSpec(spec)
  if (spec.rows.some((d) => d.grain) || spec.columns.some((d) => d.grain)) {
    throw new PivotError("e.svNoGrain")
  }
  const map = fieldMap(fields)
  const dimField = (d: DimRef) => {
    const f = lookup(map, d.fieldId)
    if (f.role !== "dimension") throw new PivotError("e.notDim", { name: f.name })
    return f
  }
  const rowF = spec.rows.map(dimField)
  const colF = spec.columns.map(dimField)

  // Every metric the query needs (direct values + those referenced by calculated metrics)
  // is requested once from SEMANTIC_VIEW as "m<k>"; values are then projected as "v<i>".
  const metricAlias = new Map<string, string>()
  const metricF: Field[] = []
  const need = (f: Field) => {
    if (!metricAlias.has(f.id)) {
      metricAlias.set(f.id, `"m${metricF.length}"`)
      metricF.push(f)
    }
    return metricAlias.get(f.id)!
  }
  const valExprs = spec.values.map((v) => {
    if (v.fieldId.startsWith(CALC_PREFIX)) {
      const ast = parseFormula(findCalc(src, v.fieldId).formula)
      formulaFields(ast, fields).forEach((f) => f.role === "metric" && need(f))
      return renderMetricsFormula(ast, fields, (f) => need(f))
    }
    const f = lookup(map, v.fieldId)
    if (f.role !== "metric") throw new PivotError("e.notMetric", { name: f.name })
    return need(f)
  })

  const binds: Bind[] = []
  const subqueries: string[] = []

  for (const [dr, dc] of groupingSets(spec)) {
    const dimsClause = [
      ...rowF.slice(0, dr).map((f, i) => `${svRef(f)} AS "r${i}"`),
      ...colF.slice(0, dc).map((f, i) => `${svRef(f)} AS "c${i}"`),
    ]
    const metricsClause = metricF.map((f) => `${svRef(f)} AS ${metricAlias.get(f.id)}`)
    const where = buildFilters(spec.filters, map, svRef, binds, false)

    const inner = [
      `SEMANTIC_VIEW(${sourceFqn(src)}`,
      dimsClause.length ? `  DIMENSIONS ${dimsClause.join(", ")}` : "",
      metricsClause.length ? `  METRICS ${metricsClause.join(", ")}` : "",
      where.length ? `  WHERE ${where.join(" AND ")}` : "",
      `)`,
    ]
      .filter(Boolean)
      .join("\n")

    const cols = [
      ...rowF.map((_, i) => (i < dr ? `"r${i}"` : `NULL AS "r${i}"`)),
      ...colF.map((_, i) => (i < dc ? `"c${i}"` : `NULL AS "c${i}"`)),
      ...valExprs.map((e, i) => `${e} AS "v${i}"`),
      `${rowF.length - dr} AS "__gr"`,
      `${colF.length - dc} AS "__gc"`,
    ]
    subqueries.push(`SELECT ${cols.join(", ")}\nFROM ${inner}`)
  }

  const limit = clampLimit(spec.limit)
  const nDims = rowF.length + colF.length
  const order = ['"__gr"', '"__gc"', ...Array.from({ length: nDims }, (_, i) => String(i + 1))]
  const sql = [
    `SELECT * FROM (\n${subqueries.join("\nUNION ALL\n")}\n)`,
    `ORDER BY ${order.join(", ")}`,
    `LIMIT ${limit + 1}`,
  ].join("\n")

  return { sql, binds, limit }
}

export function buildPivotQuery(src: Source, fields: Field[], spec: PivotSpec) {
  return src.kind === "SEMANTIC_VIEW"
    ? buildSemanticQuery(src, fields, spec)
    : buildTableQuery(src, fields, spec)
}

/** SELECT DISTINCT for a filter's value picker. */
export function buildValuesQuery(src: Source, field: Field, search: string | undefined, limit = 500) {
  const binds: Bind[] = []
  if (src.kind === "SEMANTIC_VIEW") {
    if (field.role !== "dimension") throw new PivotError("e.valuesDimsOnly")
    let sql = `SELECT "v" FROM SEMANTIC_VIEW(${sourceFqn(src)} DIMENSIONS ${svRef(field)} AS "v")`
    if (search) {
      sql += ` WHERE "v"::VARCHAR ILIKE ?`
      binds.push(`%${search}%`)
    }
    return { sql: `${sql} ORDER BY 1 LIMIT ${limit}`, binds }
  }
  const c = colRef(field)
  // Values of a model column only need its own table, not the whole join.
  let from = sourceFqn(src)
  if (src.kind === "MODEL") {
    const t = src.model?.tables.find((x) => x.alias === field.entity)
    if (!t) throw new PivotError("e.fieldNotInModel")
    from = `${[t.database, t.schema, t.name].map(quoteIdent).join(".")} AS ${quoteIdent(t.alias)}`
  }
  let sql = `SELECT DISTINCT ${c} AS "v" FROM ${from}`
  if (search) {
    sql += ` WHERE ${c}::VARCHAR ILIKE ?`
    binds.push(`%${search}%`)
  }
  return { sql: `${sql} ORDER BY 1 LIMIT ${limit}`, binds }
}

/** SQL fragment for a calculated metric (validation + preview in the editor). */
export function previewCalcSql(src: Source, fields: Field[], formula: string): string {
  const ast = parseFormula(formula)
  if (src.kind === "SEMANTIC_VIEW") return renderMetricsFormula(ast, fields, svRef)
  return renderTableFormula(ast, fields, colRef)
}

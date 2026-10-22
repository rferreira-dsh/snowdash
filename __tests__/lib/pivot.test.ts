import { describe, expect, it } from "vitest"
import { buildPivotQuery, buildValuesQuery, PivotError, quoteIdent } from "../../lib/pivot/sql"
import { buildGrid, cellKey, keyStr } from "../../lib/pivot/transform"
import { COUNT_ROWS_ID, type Field, type PivotSpec, type Source } from "../../lib/pivot/types"

const table: Source = { database: "DB", schema: "S", name: "VENDAS", kind: "TABLE" }
const tFields: Field[] = [
  { id: "UF", name: "UF", role: "dimension", dataType: "TEXT", family: "text" },
  { id: "DT", name: "DT", role: "dimension", dataType: "DATE", family: "date" },
  { id: "CANAL", name: "CANAL", role: "dimension", dataType: "TEXT", family: "text" },
  { id: "VALOR", name: "VALOR", role: "measure", dataType: "NUMBER", family: "number" },
]
const sv: Source = { database: "DB", schema: "S", name: "SV", kind: "SEMANTIC_VIEW" }
const svFields: Field[] = [
  { id: "T.UF", name: "UF", entity: "T", role: "dimension", dataType: "TEXT", family: "text" },
  { id: "T.CANAL", name: "CANAL", entity: "T", role: "dimension", dataType: "TEXT", family: "text" },
  { id: "T.TOTAL", name: "TOTAL", entity: "T", role: "metric", dataType: "NUMBER", family: "number" },
]

const spec = (p: Partial<PivotSpec>): PivotSpec => ({
  rows: [],
  columns: [],
  values: [],
  filters: [],
  totals: false,
  limit: 100,
  ...p,
})

describe("quoteIdent", () => {
  it("doubles embedded quotes", () => {
    expect(quoteIdent('a"b')).toBe('"a""b"')
  })
})

describe("table queries", () => {
  it("groups rows/columns and aggregates values", () => {
    const q = buildPivotQuery(
      table,
      tFields,
      spec({ rows: [{ fieldId: "UF" }], columns: [{ fieldId: "CANAL" }], values: [{ fieldId: "VALOR", agg: "SUM" }] }),
    )
    expect(q.sql).toContain(`SUM("VALOR") AS "v0"`)
    expect(q.sql).toContain(`GROUP BY "UF", "CANAL"`)
    expect(q.sql).toContain(`FROM "DB"."S"."VENDAS"`)
    expect(q.sql).toContain("LIMIT 101")
  })

  it("uses GROUPING SETS for totals", () => {
    const q = buildPivotQuery(
      table,
      tFields,
      spec({ rows: [{ fieldId: "UF" }], columns: [{ fieldId: "CANAL" }], values: [{ fieldId: COUNT_ROWS_ID, agg: "COUNT" }], totals: true }),
    )
    expect(q.sql).toContain(`GROUPING SETS (("UF", "CANAL"), ("UF"), ("CANAL"), ())`)
    expect(q.sql).toContain(`GROUPING("UF") AS "__gr"`)
  })

  it("binds filter values and applies date grain", () => {
    const q = buildPivotQuery(
      table,
      tFields,
      spec({
        rows: [{ fieldId: "DT", grain: "month" }],
        values: [{ fieldId: "VALOR", agg: "AVG" }],
        filters: [
          { fieldId: "UF", op: "in", values: ["SP", "x' OR 1=1 --"] },
          { fieldId: "DT", op: "gte", values: ["2026-01-01T00:00:00.000Z"] },
        ],
      }),
    )
    expect(q.sql).toContain(`DATE_TRUNC('MONTH', "DT")`)
    expect(q.sql).toContain(`"UF" IN (?, ?)`)
    expect(q.sql).not.toContain("OR 1=1")
    expect(q.binds).toEqual(["SP", "x' OR 1=1 --", "2026-01-01"])
  })

  it("rejects unknown fields and invalid aggregations", () => {
    expect(() => buildPivotQuery(table, tFields, spec({ rows: [{ fieldId: 'X"; DROP TABLE t; --' }] }))).toThrow(PivotError)
    expect(() => buildPivotQuery(table, tFields, spec({ values: [{ fieldId: "UF", agg: "SUM" }] }))).toThrow(PivotError)
    expect(() => buildPivotQuery(table, tFields, spec({ values: [{ fieldId: "VALOR", agg: "DROP" as never }] }))).toThrow(PivotError)
  })
})

describe("semantic view queries", () => {
  it("builds SEMANTIC_VIEW clauses with aliases and totals union", () => {
    const q = buildPivotQuery(
      sv,
      svFields,
      spec({
        rows: [{ fieldId: "T.CANAL" }],
        values: [{ fieldId: "T.TOTAL", agg: "METRIC" }],
        filters: [{ fieldId: "T.UF", op: "in", values: ["SP"] }],
        totals: true,
      }),
    )
    expect(q.sql).toContain(`DIMENSIONS "T"."CANAL" AS "r0"`)
    expect(q.sql).toContain(`METRICS "T"."TOTAL" AS "v0"`)
    expect(q.sql).toContain("UNION ALL")
    expect(q.binds).toEqual(["SP", "SP"]) // filter repeated in each grouping set
  })

  it("rejects metrics on rows and dimensions in values", () => {
    expect(() => buildPivotQuery(sv, svFields, spec({ rows: [{ fieldId: "T.TOTAL" }] }))).toThrow(PivotError)
    expect(() => buildPivotQuery(sv, svFields, spec({ values: [{ fieldId: "T.UF", agg: "METRIC" }] }))).toThrow(PivotError)
  })

  it("values query uses a dimension-only SEMANTIC_VIEW", () => {
    const q = buildValuesQuery(sv, svFields[0], "s")
    expect(q.sql).toContain(`DIMENSIONS "T"."UF" AS "v"`)
    expect(q.binds).toEqual(["%s%"])
  })
})

describe("buildGrid", () => {
  it("separates detail cells, row/col totals and grand total", () => {
    const s = spec({ rows: [{ fieldId: "UF" }], columns: [{ fieldId: "CANAL" }], values: [{ fieldId: "VALOR", agg: "SUM" }], totals: true })
    const g = buildGrid(
      [
        { r0: "SP", c0: "APP", v0: 10, __gr: 0, __gc: 0 },
        { r0: "RJ", c0: "WEB", v0: 5, __gr: 0, __gc: 0 },
        { r0: "SP", c0: null, v0: 10, __gr: 0, __gc: 1 },
        { r0: null, c0: "APP", v0: 10, __gr: 1, __gc: 0 },
        { r0: null, c0: null, v0: 15, __gr: 1, __gc: 1 },
      ],
      s,
    )
    expect(g.rowKeys).toEqual([["SP"], ["RJ"]])
    expect(g.colKeys).toEqual([["APP"], ["WEB"]])
    expect(g.cells.get(cellKey(["SP"], ["APP"]))).toEqual([10])
    expect(g.rowTotals.get(keyStr(["SP"]))).toEqual([10])
    expect(g.colTotals.get(keyStr(["APP"]))).toEqual([10])
    expect(g.grand).toEqual([15])
  })
})

import { makeAlias, removeTable, suggestJoin } from "../../lib/pivot/model"

describe("data models", () => {
  const f = (alias: string, name: string, role: Field["role"] = "dimension", family: Field["family"] = "number"): Field => ({
    id: `${alias}.${name}`, name, entity: alias, role, dataType: "NUMBER", family,
  })
  const custFields = [f("CUSTOMER", "C_CUSTKEY"), f("CUSTOMER", "C_NAME", "dimension", "text"), f("CUSTOMER", "C_NATIONKEY"), f("CUSTOMER", "C_COMMENT", "dimension", "text")]
  const ordFields = [f("ORDERS", "O_ORDERKEY"), f("ORDERS", "O_CUSTKEY"), f("ORDERS", "O_TOTALPRICE", "measure"), f("ORDERS", "O_COMMENT", "dimension", "text")]
  const model = { tables: [{ database: "SNOWFLAKE_SAMPLE_DATA", schema: "TPCH_SF1", name: "CUSTOMER", alias: "CUSTOMER" }] }

  it("suggests C_CUSTKEY = O_CUSTKEY and ignores non-key columns", () => {
    expect(suggestJoin(model, custFields, ordFields)).toEqual({ toAlias: "CUSTOMER", type: "LEFT", pairs: [{ left: "C_CUSTKEY", right: "O_CUSTKEY" }] })
  })

  it("builds FROM with joins and alias-qualified columns", () => {
    const src: Source = {
      database: "SNOWFLAKE_SAMPLE_DATA", schema: "TPCH_SF1", name: "CUSTOMER", kind: "MODEL",
      model: { tables: [...model.tables, { database: "SNOWFLAKE_SAMPLE_DATA", schema: "TPCH_SF1", name: "ORDERS", alias: "ORDERS", join: { toAlias: "CUSTOMER", type: "LEFT", pairs: [{ left: "C_CUSTKEY", right: "O_CUSTKEY" }] } }] },
    }
    const q = buildPivotQuery(src, [...custFields, ...ordFields], spec({ rows: [{ fieldId: "CUSTOMER.C_NAME" }], values: [{ fieldId: "ORDERS.O_TOTALPRICE", agg: "SUM" }] }))
    expect(q.sql).toContain(`"SNOWFLAKE_SAMPLE_DATA"."TPCH_SF1"."CUSTOMER" AS "CUSTOMER"`)
    expect(q.sql).toContain(`LEFT JOIN "SNOWFLAKE_SAMPLE_DATA"."TPCH_SF1"."ORDERS" AS "ORDERS" ON "CUSTOMER"."C_CUSTKEY" = "ORDERS"."O_CUSTKEY"`)
    expect(q.sql).toContain(`SUM("ORDERS"."O_TOTALPRICE") AS "v0"`)
  })

  it("rejects join keys that are not real columns", () => {
    const src: Source = {
      database: "D", schema: "S", name: "CUSTOMER", kind: "MODEL",
      model: { tables: [...model.tables, { database: "D", schema: "S", name: "ORDERS", alias: "ORDERS", join: { toAlias: "CUSTOMER", type: "LEFT", pairs: [{ left: "1=1 --", right: "O_CUSTKEY" }] } }] },
    }
    expect(() => buildPivotQuery(src, [...custFields, ...ordFields], spec({ values: [{ fieldId: COUNT_ROWS_ID, agg: "COUNT" }] }))).toThrow(PivotError)
  })

  it("aliases are unique and removal cascades", () => {
    expect(makeAlias("ORDERS", ["ORDERS"])).toBe("ORDERS_2")
    const m = { tables: [
      { database: "D", schema: "S", name: "A", alias: "A" },
      { database: "D", schema: "S", name: "B", alias: "B", join: { toAlias: "A", type: "LEFT" as const, pairs: [] } },
      { database: "D", schema: "S", name: "C", alias: "C", join: { toAlias: "B", type: "LEFT" as const, pairs: [] } },
    ] }
    expect(removeTable(m, "B").tables.map((t) => t.alias)).toEqual(["A"])
  })
})

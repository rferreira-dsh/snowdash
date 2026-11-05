import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { parseXml, kid } from "@/lib/tableau/xml"
import { parseTwb, shelfTokens, splitBrackets } from "@/lib/tableau/twb"
import { convertWorkbook, literal, parseInstance, translateFormula } from "@/lib/tableau/convert"
import { parseSource } from "@/lib/pivot/catalog"
import { fromClause } from "@/lib/pivot/sql"
import { COUNT_ROWS_ID } from "@/lib/pivot/types"

const xml = readFileSync(join(__dirname, "../fixtures/sales.twb"), "utf8")
let n = 0
const result = () => convertWorkbook(parseTwb(xml), { uuid: () => `id-${++n}` })
const codes = (r: ReturnType<typeof result>) => r.warnings.map((w) => w.code)

describe("xml parser", () => {
  it("handles entities, self-closing tags, quotes and comments", () => {
    const r = parseXml(`<?xml version='1.0'?><!-- c --><a x="1 > 0" y='it&apos;s'><b/><c>t &amp; &#10;u<![CDATA[<raw>]]></c></a>`)
    const a = kid(r, "a")!
    expect(a.attrs).toEqual({ x: "1 > 0", y: "it's" })
    expect(a.children.map((c) => c.tag)).toEqual(["b", "c"])
    expect(kid(a, "c")!.text).toBe("t & \nu<raw>")
  })
  it("splits bracket paths and shelf tokens", () => {
    expect(splitBrackets("[EDW].[SC].[T]")).toEqual(["EDW", "SC", "T"])
    expect(splitBrackets("[a]]b]")).toEqual(["a]b"])
    expect(shelfTokens("([ds].[none:A:nk] / [ds].[__tableau_internal_object_id__].[cnt:X:qk])").map((t) => t.inst)).toEqual([
      "none:A:nk",
      "cnt:X:qk",
    ])
  })
})

describe("twb extraction", () => {
  const wb = parseTwb(xml)
  it("reads datasource, connection, objects and relationships", () => {
    expect(wb.datasources).toHaveLength(1)
    const ds = wb.datasources[0]
    expect(ds).toMatchObject({ caption: "SALES_CUBE", connectionClass: "snowflake", database: "EDW", warehouse: "REPORTING_WH" })
    expect(ds.objects.map((o) => `${o.database}.${o.schema}.${o.table}`)).toEqual([
      "EDW.SALES.FACT_SALES",
      "EDW.CALENDAR.DIM_DATE",
      "EDW.SALES.DIM_PRODUCT",
      "EDW.SALES.ORPHAN",
    ])
    expect(ds.relationships).toHaveLength(2)
    expect(ds.folders.map((f) => f.name)).toEqual(["Measures", "Product", "Empty"])
    expect(wb.parameters[0]).toMatchObject({ caption: "As Of Date Parameter", value: "#2026-09-30#" })
  })
  it("reads worksheets with Measure Names in manual-sort order", () => {
    const w = wb.worksheets[0]
    expect(w.rows).toEqual(["none:Product Type:nk", "none:Calculation_3:nk"])
    expect(w.cols).toEqual([":Measure Names"])
    expect(w.rowTotal).toBe(true)
    expect(w.measureNames).toEqual(["usr:Calculation_1:qk", "sum:AMOUNT:qk", "ctd:Order ID:qk"])
  })
})

describe("convert: model", () => {
  const r = result()
  const tables = r.source.model!.tables
  it("builds a star with the fact table as base", () => {
    expect(r.source.kind).toBe("MODEL")
    expect(tables.map((t) => t.alias)).toEqual(["FACT_SALES", "DIM_DATE", "DIM_PRODUCT"])
    expect(tables[1].join).toEqual({ toAlias: "FACT_SALES", type: "LEFT", pairs: [{ left: "SALEDATE", right: "DATE" }] })
    expect(tables[2].join?.pairs).toEqual([{ left: "PRODUCTKEY", right: "PRODUCTKEY", leftCast: "number" }])
    expect(r.warehouse).toBe("REPORTING_WH")
  })
  it("renders key casts as TRY_ conversions in the join", () => {
    const fields = tables.flatMap((t) =>
      ["SALEDATE", "DATE", "PRODUCTKEY"].map((c) => ({ id: `${t.alias}.${c}`, name: c, entity: t.alias, role: "dimension" as const, dataType: "TEXT", family: "text" as const })),
    )
    expect(fromClause(r.source, fields)).toContain('ON TRY_TO_NUMBER(TO_VARCHAR("FACT_SALES"."PRODUCTKEY")) = "DIM_PRODUCT"."PRODUCTKEY"')
  })
  it("warns about unlinked tables", () => {
    expect(codes(r)).not.toContain("keyFunc")
    expect(r.warnings.find((w) => w.code === "unlinked")?.vars?.name).toBe("ORPHAN")
  })
  it("maps captions, hidden fields, roles and folders to field ids", () => {
    expect(r.source.labels?.["FACT_SALES.AMOUNT"]).toBe("Amount")
    expect(r.source.labels?.["DIM_DATE.DATE"]).toBe("As of Date")
    expect(r.source.labels?.["FACT_SALES.Order ID"]).toBeUndefined() // same as the column
    expect(r.source.hidden).toEqual(["FACT_SALES.PRODUCTKEY"])
    expect(r.source.roles?.["FACT_SALES.AMOUNT"]).toBe("measure")
    expect(r.source.folders).toEqual([
      { id: "tb1", name: "Measures", fieldIds: ["FACT_SALES.AMOUNT", "calc:tb_1"] },
      { id: "tb2", name: "Product", fieldIds: ["DIM_PRODUCT.Product Type"] },
    ])
    expect(codes(r)).toContain("folderItems")
  })
  it("passes SnowBook source validation", () => {
    expect(() => parseSource(r.source)).not.toThrow()
  })
  it("applies database/schema remaps", () => {
    const rr = convertWorkbook(parseTwb(xml), { remap: { database: { edw: "F_DEV_EDW" }, schema: { CALENDAR: "CAL" } } })
    expect(rr.source.model!.tables.map((t) => `${t.database}.${t.schema}`)).toEqual(["F_DEV_EDW.SALES", "F_DEV_EDW.CAL", "F_DEV_EDW.SALES"])
  })
})

describe("convert: calculations", () => {
  const r = result()
  it("translates aggregate formulas", () => {
    expect(r.source.calcs).toEqual([
      { id: "tb_1", name: "Avg Ticket", formula: "SUM([FACT_SALES.AMOUNT]) / COUNT_DISTINCT([FACT_SALES.Order ID])", format: "number", decimals: 2 },
      {
        id: "tb_2",
        name: "PPL Amount",
        formula: "SUM(IF([DIM_PRODUCT.Product Type] = 'PPL', COALESCE([FACT_SALES.AMOUNT], 0), 0))",
        format: "number",
        decimals: 2,
      },
    ])
  })
  it("skips row-level, parameter, LOD and table calcs with a reason", () => {
    const skipped = r.warnings.filter((w) => w.code === "calcSkipped").map((w) => [w.vars?.name, w.vars?.reason])
    expect(skipped).toEqual([
      ["Is Month End", "syntax"],
      ["As of Filter", "parameter"],
    ])
    const id = (l: string) => (l === "[X]" ? "T.X" : null)
    expect(translateFormula("{FIXED [X] : SUM([X])}", id)).toEqual({ ok: false, reason: "lod" })
    expect(translateFormula("RUNNING_SUM(SUM([X]))", id)).toEqual({ ok: false, reason: "tableCalc" })
    expect(translateFormula("[X] * 2", id)).toEqual({ ok: false, reason: "rowLevel" })
    expect(translateFormula("SUM([Y])", id)).toEqual({ ok: false, reason: "field:Y" })
    expect(translateFormula("IF SUM([X]) > 0 THEN SUM([X]) ELSE 0 END", id)).toEqual({ ok: true, formula: "IF(SUM([T.X]) > 0, SUM([T.X]), 0)" })
  })
})

describe("convert: worksheets", () => {
  const r = result()
  const [totals, over] = r.sheets
  it("maps shelves, Measure Names and totals", () => {
    expect(totals.name).toBe("Totals by product")
    expect(totals.spec.rows).toEqual([{ fieldId: "DIM_PRODUCT.Product Type" }])
    expect(totals.spec.columns).toEqual([])
    expect(totals.spec.values).toEqual([
      { fieldId: "calc:tb_1", agg: "CALC" },
      { fieldId: "FACT_SALES.AMOUNT", agg: "SUM" },
      { fieldId: "FACT_SALES.Order ID", agg: "COUNT_DISTINCT" },
    ])
    expect(totals.spec.totals).toBe(true)
    expect(totals.view).toBe("table")
  })
  it("maps filters (in, exclude) and reports what it cannot map", () => {
    expect(totals.spec.filters).toEqual([
      { fieldId: "DIM_DATE.DATE", op: "in", values: ["2026-09-30"] },
      { fieldId: "DIM_PRODUCT.Product Type", op: "not_in", values: ["XYZ"] },
    ])
    const sheetCodes = r.warnings.filter((w) => w.vars?.sheet === "Totals by product").map((w) => w.code)
    expect(sheetCodes).toEqual(expect.arrayContaining(["calcDim", "filterRelative", "filterAgg"]))
  })
  it("maps date grains, month filters to ranges, object counts and line marks", () => {
    expect(over.spec.columns).toEqual([{ fieldId: "DIM_DATE.DATE", grain: "month" }])
    expect(over.spec.values).toEqual([
      { fieldId: "FACT_SALES.AMOUNT", agg: "SUM" },
      { fieldId: COUNT_ROWS_ID, agg: "COUNT" },
    ])
    expect(over.spec.filters).toEqual([{ fieldId: "DIM_DATE.DATE", op: "between", values: ["2026-01-01", "2026-03-31"] }])
    expect(over).toMatchObject({ view: "chart", chartKind: "line" })
  })
  it("parses instances and literals", () => {
    expect(parseInstance("tmn:DATE (DIM_DATE):ok")).toEqual({ deriv: "tmn", name: "DATE (DIM_DATE)" })
    expect(parseInstance(":Measure Names").special).toBe("measureNames")
    expect(literal('"PP""L"')).toBe('PP"L')
    expect(literal("#2026-01-01 00:00:00#")).toBe("2026-01-01")
    expect(literal("12.5")).toBe(12.5)
    expect(literal("%null%")).toBeNull()
  })
})

describe("convert: errors", () => {
  it("rejects workbooks without tables", () => {
    expect(() => convertWorkbook(parseTwb("<workbook><datasources/></workbook>"))).toThrow()
    expect(() => parseTwb("<html/>")).toThrow()
  })
})

import { describe, expect, it } from "vitest"
import { FormulaError, parseFormula, renderMetricsFormula, renderTableFormula } from "../../lib/pivot/formula"
import type { Field } from "../../lib/pivot/types"

const f = (id: string, role: Field["role"] = "measure", family: Field["family"] = "number", entity?: string): Field => ({
  id,
  name: id.includes(".") ? id.split(".")[1] : id,
  entity,
  role,
  dataType: "NUMBER",
  family,
})
const fields = [f("RECEITA"), f("CUSTO"), f("PRIORIDADE", "dimension", "text"), f("PEDIDO", "dimension")]
const col = (x: Field) => `"${x.name}"`
const table = (src: string) => renderTableFormula(parseFormula(src), fields, col)

describe("formula: table mode", () => {
  it("renders aggregates, arithmetic and safe division", () => {
    expect(table("(SUM([RECEITA]) - SUM([CUSTO])) / SUM([RECEITA])")).toBe(
      '((SUM("RECEITA") - SUM("CUSTO")) / NULLIF(SUM("RECEITA"), 0))',
    )
  })

  it("supports IF, COUNT_DISTINCT, COUNT_ROWS and string literals", () => {
    expect(table("SUM(IF([PRIORIDADE] = '1-URGENT', 1, 0))")).toBe(`SUM(IFF(("PRIORIDADE" = '1-URGENT'), 1, 0))`)
    expect(table("COUNT_DISTINCT([PEDIDO]) / COUNT_ROWS()")).toBe('(COUNT(DISTINCT "PEDIDO") / NULLIF(COUNT(*), 0))')
  })

  it("escapes quotes and backslashes in strings", () => {
    expect(table("SUM(IF([PRIORIDADE] = 'a''b\\', 1, 0))")).toContain(`'a''b\\\\'`)
  })

  it("resolves names case-insensitively", () => {
    expect(table("sum([receita])")).toBe('SUM("RECEITA")')
  })

  it("rejects raw SQL, unknown fields/functions and bare columns", () => {
    const bad = [
      "SUM([RECEITA]); DROP TABLE x",
      "SUM([RECEITA]) -- x",
      "SELECT 1",
      "SUM([NAO_EXISTE])",
      "[RECEITA] * 2",
      "SUM(SUM([RECEITA]))",
      "EXEC(1)",
      "SUM([RECEITA]",
      "'unterminated",
      "",
    ]
    for (const b of bad) expect(() => table(b), b).toThrow(FormulaError)
  })

  it("asks to qualify ambiguous names in models", () => {
    const mf = [f("A.ID", "dimension", "number", "A"), f("B.ID", "dimension", "number", "B")]
    expect(() => renderTableFormula(parseFormula("COUNT([ID])"), mf, col)).toThrow(FormulaError)
    expect(renderTableFormula(parseFormula("COUNT([B.ID])"), mf, (x) => `"${x.entity}"."${x.name}"`)).toBe('COUNT("B"."ID")')
  })
})

describe("formula: semantic-view metrics mode", () => {
  const sv = [f("T.TOTAL", "metric", "number", "T"), f("T.QTD", "metric", "number", "T"), f("T.UF", "dimension", "text", "T")]
  it("combines metrics without aggregates", () => {
    expect(renderMetricsFormula(parseFormula("[TOTAL] / [QTD] * 100"), sv, (x) => `"m_${x.name}"`)).toBe(
      '((\"m_TOTAL\" / NULLIF(\"m_QTD\", 0)) * 100)',
    )
  })
  it("rejects aggregates and dimensions", () => {
    expect(() => renderMetricsFormula(parseFormula("SUM([TOTAL])"), sv, col)).toThrow(FormulaError)
    expect(() => renderMetricsFormula(parseFormula("[UF]"), sv, col)).toThrow(FormulaError)
  })
})

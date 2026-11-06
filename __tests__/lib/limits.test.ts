import { afterEach, describe, expect, it } from "vitest"
import { configuredLimits, resolveLimits } from "../../lib/pivot/limits"
import { buildPivotQuery, PivotError } from "../../lib/pivot/sql"
import type { Field, PivotSpec, Source } from "../../lib/pivot/types"

const env = { ...process.env }
afterEach(() => {
  process.env = { ...env }
})

describe("configuredLimits", () => {
  it("falls back to 8/4/12 with no admin ceiling", () => {
    delete process.env.SNOWDASH_LIMITS_DEFAULT
    delete process.env.SNOWDASH_LIMITS_MAX
    expect(configuredLimits()).toEqual({ default: { rows: 8, columns: 4, values: 12 }, max: null })
  })
  it("treats MAX=none as unlimited", () => {
    process.env.SNOWDASH_LIMITS_MAX = "none"
    expect(configuredLimits().max).toBeNull()
  })
  it("reads env and keeps default under the ceiling", () => {
    process.env.SNOWDASH_LIMITS_DEFAULT = "10, 20, x"
    process.env.SNOWDASH_LIMITS_MAX = "12,6,40"
    expect(configuredLimits()).toEqual({ default: { rows: 10, columns: 6, values: 12 }, max: { rows: 12, columns: 6, values: 40 } })
  })
})

describe("resolveLimits", () => {
  it("uses the default when nothing is requested", () => {
    expect(resolveLimits(undefined, false)).toEqual({ rows: 8, columns: 4, values: 12 })
  })
  it("caps regular users at the default but lets them go lower", () => {
    expect(resolveLimits({ rows: 50, columns: 2, values: "abc" }, false)).toEqual({ rows: 8, columns: 2, values: 12 })
  })
  it("leaves admins unlimited without a ceiling", () => {
    expect(resolveLimits({ rows: 50 }, true)).toBeNull()
  })
  it("caps admins at the ceiling when one is set", () => {
    process.env.SNOWDASH_LIMITS_MAX = "16,8,30"
    expect(resolveLimits({ rows: 50, columns: 6, values: 20 }, true)).toEqual({ rows: 16, columns: 6, values: 20 })
  })
})

describe("validateSpec limits", () => {
  const src: Source = { database: "DB", schema: "S", name: "T", kind: "TABLE" }
  const fields: Field[] = Array.from({ length: 10 }, (_, i) => ({
    id: `D${i}`, name: `D${i}`, role: "dimension" as const, dataType: "TEXT", family: "text" as const,
  }))
  const spec = (n: number, limits?: PivotSpec["limits"]): PivotSpec => ({
    rows: fields.slice(0, n).map((f) => ({ fieldId: f.id })), columns: [], values: [], filters: [], totals: false, limit: 100, limits,
  })
  it("rejects more rows than the default", () => {
    expect(() => buildPivotQuery(src, fields, spec(9))).toThrow(PivotError)
  })
  it("accepts them when spec.limits allows it", () => {
    expect(() => buildPivotQuery(src, fields, spec(9, { rows: 10, columns: 4, values: 12 }))).not.toThrow()
  })
  it("skips the check when limits are null (unlimited admin)", () => {
    expect(() => buildPivotQuery(src, fields, spec(10, null))).not.toThrow()
  })
})

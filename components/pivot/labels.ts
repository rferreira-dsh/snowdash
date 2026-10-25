import { CALC_PREFIX, COUNT_ROWS_ID, type Agg, type CalcMetric, type Field, type Grain, type ValueRef } from "@/lib/pivot/types"
import { currentLocale, t } from "@/lib/i18n/client"

export const aggLabel = (a: Agg) => t(`agg.${a}`)
export const grainLabel = (g: Grain) => t(`grain.${g}`)

export const COUNT_ROWS_FIELD: Field = {
  id: COUNT_ROWS_ID,
  name: "Nº de registros",
  role: "measure",
  dataType: "NUMBER",
  family: "number",
}

/** Display name; the synthetic count-rows field is translated. */
export function fieldLabel(f: Field | undefined, id: string): string {
  if (id === COUNT_ROWS_ID || f?.id === COUNT_ROWS_ID) return t("field.countRows")
  return f ? f.name : id
}

export function valueLabel(v: ValueRef, f: Field | undefined): string {
  if (v.fieldId === COUNT_ROWS_ID) return t("field.countRows")
  const name = fieldLabel(f, v.fieldId)
  return v.agg === "METRIC" || v.agg === "CALC" ? name : t("agg.of", { agg: aggLabel(v.agg), name })
}

export function formatNumber(v: unknown): string {
  if (v === null || v === undefined || v === "") return ""
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 2 }).format(n) : String(v)
}

/** Dimension member display; ISO dates are trimmed when time is midnight. */
export function formatMember(v: unknown, family?: string): string {
  if (v === null || v === undefined) return t("member.null")
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return v.endsWith("T00:00:00.000Z") ? v.slice(0, 10) : v.replace("T", " ").replace(/\.\d+Z$/, "")
  }
  if (family === "number") return formatNumber(v)
  return String(v)
}

/** Pseudo-field so a calculated metric can be listed, dragged and labelled like any field. */
export function calcField(c: CalcMetric): Field {
  return { id: CALC_PREFIX + c.id, name: c.name, role: "measure", dataType: "CALC", family: "number", calc: c }
}

/** Format a value cell; calculated metrics carry their own number/percent/currency format. */
export function formatValue(v: unknown, f: Field | undefined): string {
  const c = f?.calc
  if (!c) return formatNumber(v)
  if (v === null || v === undefined || v === "") return ""
  const n = typeof v === "number" ? v : Number(v)
  if (!Number.isFinite(n)) return String(v)
  const digits = { minimumFractionDigits: c.decimals, maximumFractionDigits: c.decimals }
  if (c.format === "percent") return new Intl.NumberFormat(currentLocale(), { style: "percent", ...digits }).format(n)
  if (c.format === "currency") {
    return new Intl.NumberFormat(currentLocale(), { style: "currency", currency: c.currency || "BRL", ...digits }).format(n)
  }
  return new Intl.NumberFormat(currentLocale(), digits).format(n)
}

/**
 * Server-side check of an imported Tableau model against Snowflake (caller's rights):
 * tables must exist; fields, folders, labels, calcs and sheet items that do not resolve are dropped.
 */

import { getCachedFields } from "../pivot/cache"
import { parseFormula, renderTableFormula } from "../pivot/formula"
import { CALC_PREFIX, COUNT_ROWS_ID, type Field, type PivotSpec } from "../pivot/types"
import type { ImportResult, ImportWarning } from "./convert"

export interface ValidatedImport extends ImportResult {
  errors: ImportWarning[]
}

export async function validateImport(r: ImportResult): Promise<ValidatedImport> {
  const tables = r.source.model?.tables ?? []
  const errors: ImportWarning[] = []
  const warnings = [...r.warnings]
  const fields: Field[] = []
  await Promise.all(
    tables.map(async (t) => {
      try {
        const cols = await getCachedFields({ database: t.database, schema: t.schema, name: t.name, kind: "TABLE" })
        for (const c of cols) fields.push({ ...c, id: `${t.alias}.${c.name}`, entity: t.alias })
      } catch {
        errors.push({ code: "tableMissing", vars: { name: `${t.database}.${t.schema}.${t.name}` } })
      }
    }),
  )
  // A missing table makes every other check noisy; report it and let the user remap first.
  if (errors.length) return { ...r, warnings, errors }

  const ids = new Set(fields.map((f) => f.id))
  for (const t of tables) {
    for (const p of t.join?.pairs ?? []) {
      if (!ids.has(`${t.join!.toAlias}.${p.left}`)) errors.push({ code: "joinColumn", vars: { name: `${t.join!.toAlias}.${p.left}` } })
      if (!ids.has(`${t.alias}.${p.right}`)) errors.push({ code: "joinColumn", vars: { name: `${t.alias}.${p.right}` } })
    }
  }

  const calcs = (r.source.calcs ?? []).filter((c) => {
    try {
      renderTableFormula(parseFormula(c.formula), fields, () => "x")
      return true
    } catch (e) {
      warnings.push({ code: "calcSkipped", vars: { name: c.name, reason: "invalid", formula: c.formula, err: e instanceof Error ? e.message : String(e) } })
      return false
    }
  })
  const calcIds = new Set(calcs.map((c) => CALC_PREFIX + c.id))
  const ok = (id: string) => ids.has(id) || calcIds.has(id) || id === COUNT_ROWS_ID

  const missing = new Set<string>()
  const keep = <T extends { fieldId: string }>(xs: T[]) =>
    xs.filter((x) => {
      if (ok(x.fieldId)) return true
      missing.add(x.fieldId)
      return false
    })
  const sheets = r.sheets.map((s) => {
    const spec: PivotSpec = { ...s.spec, rows: keep(s.spec.rows), columns: keep(s.spec.columns), values: keep(s.spec.values), filters: keep(s.spec.filters) }
    return { ...s, spec }
  })
  for (const id of missing) warnings.push({ code: "columnMissing", vars: { name: id } })

  const pick = <V>(m: Record<string, V> | undefined) => (m ? Object.fromEntries(Object.entries(m).filter(([k]) => ids.has(k))) : undefined)
  const folders = r.source.folders?.map((f) => ({ ...f, fieldIds: f.fieldIds.filter(ok) })).filter((f) => f.fieldIds.length)
  const source = {
    ...r.source,
    calcs: calcs.length ? calcs : undefined,
    folders: folders?.length ? folders : undefined,
    labels: pick(r.source.labels),
    roles: pick(r.source.roles),
    hidden: r.source.hidden?.filter((h) => ids.has(h)),
  }
  return { ...r, source, sheets, warnings, errors }
}

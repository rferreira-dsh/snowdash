/** Pure helpers for building data models (multi-table joins) on the client. */

import type { DataModel, Field, ModelTable, Source } from "./types"

/** Alias from the table name, made unique within the model (A–Z, 0–9, _ ; max 31). */
export function makeAlias(name: string, taken: string[]): string {
  let base = name.toUpperCase().replace(/[^A-Z0-9_]/g, "_").replace(/^[^A-Z]+/, "")
  base = (base || "T").slice(0, 28)
  let alias = base
  for (let i = 2; taken.includes(alias); i++) alias = `${base}_${i}`
  return alias
}

const KEYISH = /(KEY|ID|COD|CODIGO|CD|NR|NUM|SK|NK)$/
/** Strip short table prefixes like C_, O_, L_ (TPC-H style) for comparison. */
function norm(col: string): string {
  return col.toUpperCase().replace(/^[A-Z]{1,3}_/, "")
}

/**
 * Suggest how a new table joins the model: same-name key columns, or key columns
 * equal after removing a short prefix (C_CUSTKEY ↔ O_CUSTKEY). Picks the model table
 * with the most matching key pairs; returns null when nothing matches.
 */
export function suggestJoin(
  model: DataModel,
  modelFields: Field[],
  newCols: Field[],
): ModelTable["join"] | null {
  let best: ModelTable["join"] | null = null
  for (const t of model.tables) {
    const cols = modelFields.filter((f) => f.entity === t.alias)
    const pairs: { left: string; right: string }[] = []
    for (const nc of newCols) {
      const n = nc.name.toUpperCase()
      if (!KEYISH.test(norm(n))) continue
      const exact = cols.find((c) => c.name.toUpperCase() === n)
      const loose = exact ?? cols.find((c) => norm(c.name) === norm(n) && KEYISH.test(norm(c.name)))
      if (loose && !pairs.some((p) => p.left === loose.name)) pairs.push({ left: loose.name, right: nc.name })
    }
    // Prefer a single strongest key when several match (avoid joining on every *_KEY).
    const strongest = pairs.filter((p) => {
      const tn = norm(t.name).replace(/S$/, "")
      return norm(p.left).startsWith(tn.slice(0, 4)) || norm(p.right).startsWith(tn.slice(0, 4))
    })
    const chosen = strongest.length ? strongest.slice(0, 1) : pairs.slice(0, 1)
    if (chosen.length && (!best || chosen.length > best.pairs.length)) {
      best = { toAlias: t.alias, type: "LEFT", pairs: chosen }
    }
  }
  return best
}

export function modelSource(model: DataModel): Source {
  const base = model.tables[0]
  return { database: base.database, schema: base.schema, name: base.name, kind: "MODEL", model }
}

/** Convert a plain table source into a one-table model. */
export function tableToModel(src: Source): DataModel {
  return { tables: [{ database: src.database, schema: src.schema, name: src.name, alias: makeAlias(src.name, []) }] }
}

/** Remove a table and anything joined (directly or transitively) to it. */
export function removeTable(model: DataModel, alias: string): DataModel {
  const drop = new Set([alias])
  let changed = true
  while (changed) {
    changed = false
    for (const t of model.tables) {
      if (t.join && drop.has(t.join.toAlias) && !drop.has(t.alias)) {
        drop.add(t.alias)
        changed = true
      }
    }
  }
  return { tables: model.tables.filter((t) => !drop.has(t.alias)) }
}

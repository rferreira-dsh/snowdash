/** Pure client-side reshaping of long-format pivot rows into a grid. */

import type { PivotSpec } from "./types"

const SEP = "\u0001"

export type Key = unknown[]

export interface PivotGrid {
  rowKeys: Key[]
  colKeys: Key[]
  /** cell(rowKeyIdx, colKeyIdx) → values array (one per spec.values). */
  cells: Map<string, unknown[]>
  /** Totals across columns for each row key (only when there are column dims). */
  rowTotals: Map<string, unknown[]>
  /** Totals across rows for each column key (or the grand total when no column dims). */
  colTotals: Map<string, unknown[]>
  grand: unknown[] | null
}

export function keyStr(k: Key): string {
  return k.map((v) => (v === null || v === undefined ? "\u0000" : String(v))).join(SEP)
}

export function cellKey(rk: Key, ck: Key): string {
  return keyStr(rk) + SEP + SEP + keyStr(ck)
}

function flag(v: unknown): number {
  return Number(v ?? 0)
}

export function buildGrid(rows: Record<string, unknown>[], spec: PivotSpec): PivotGrid {
  const nr = spec.rows.length
  const nc = spec.columns.length
  const nv = spec.values.length
  const rowSeen = new Map<string, Key>()
  const colSeen = new Map<string, Key>()
  const cells = new Map<string, unknown[]>()
  const rowTotals = new Map<string, unknown[]>()
  const colTotals = new Map<string, unknown[]>()
  let grand: unknown[] | null = null

  for (const r of rows) {
    const rk = Array.from({ length: nr }, (_, i) => r[`r${i}`])
    const ck = Array.from({ length: nc }, (_, i) => r[`c${i}`])
    const vals = Array.from({ length: nv }, (_, i) => r[`v${i}`])
    const gr = flag(r.__gr)
    const gc = flag(r.__gc)
    if (gr === 0 && gc === 0) {
      const rs = keyStr(rk)
      const cs = keyStr(ck)
      if (!rowSeen.has(rs)) rowSeen.set(rs, rk)
      if (!colSeen.has(cs)) colSeen.set(cs, ck)
      cells.set(cellKey(rk, ck), vals)
    } else if (gr === 0 && gc === 1) {
      rowTotals.set(keyStr(rk), vals)
    } else if (gr === 1 && gc === 0) {
      if (nr === 0) continue
      colTotals.set(keyStr(ck), vals)
    } else {
      grand = vals
    }
  }

  // With no row dims the only "column total" is the grand total; with no col dims likewise.
  if (nc === 0 && nr > 0) {
    const g = colTotals.get("")
    if (g) grand = g
  }

  return {
    rowKeys: [...rowSeen.values()],
    colKeys: [...colSeen.values()],
    cells,
    rowTotals,
    colTotals,
    grand,
  }
}

export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  const na = typeof a === "number" ? a : Number(a)
  const nb = typeof b === "number" ? b : Number(b)
  if (!Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== "string") return na - nb
  if (typeof a === "number" && typeof b === "number") return a - b
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true })
}

export function compareKeys(a: Key, b: Key): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const c = compareValues(a[i], b[i])
    if (c !== 0) return c
  }
  return 0
}

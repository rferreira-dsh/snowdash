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
  /** Every aggregate (detail, subtotals, totals) keyed by aggKey(rowPrefix, colPrefix). */
  agg: Map<string, unknown[]>
}

export function keyStr(k: Key): string {
  return k.map((v) => (v === null || v === undefined ? "\u0000" : String(v))).join(SEP)
}

export function cellKey(rk: Key, ck: Key): string {
  return keyStr(rk) + SEP + SEP + keyStr(ck)
}

/** Key for an aggregate at a given row/col prefix; prefix lengths are the grouping depths. */
export function aggKey(rk: Key, ck: Key): string {
  return `${rk.length}:${ck.length}:${cellKey(rk, ck)}`
}

export function aggAt(grid: PivotGrid, rk: Key, ck: Key): unknown[] | undefined {
  return grid.agg.get(aggKey(rk, ck))
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
  const agg = new Map<string, unknown[]>()
  let grand: unknown[] | null = null

  for (const r of rows) {
    // __gr/__gc = number of rolled-up dims on each axis (0 = detail).
    const dr = Math.max(0, nr - flag(r.__gr))
    const dc = Math.max(0, nc - flag(r.__gc))
    const rk = Array.from({ length: dr }, (_, i) => r[`r${i}`])
    const ck = Array.from({ length: dc }, (_, i) => r[`c${i}`])
    const vals = Array.from({ length: nv }, (_, i) => r[`v${i}`])
    agg.set(aggKey(rk, ck), vals)
    if (dr === nr && dc === nc) {
      const rs = keyStr(rk)
      const cs = keyStr(ck)
      if (!rowSeen.has(rs)) rowSeen.set(rs, rk)
      if (!colSeen.has(cs)) colSeen.set(cs, ck)
      cells.set(cellKey(rk, ck), vals)
    }
    const detail = dr === nr && dc === nc
    if (dr === 0 && dc === 0 && !(detail && nr + nc > 0)) grand = vals
    if (nc > 0 && dr === nr && dc === 0) rowTotals.set(keyStr(rk), vals)
    if (nr > 0 && dr === 0 && dc === nc) colTotals.set(keyStr(ck), vals)
  }

  return {
    rowKeys: [...rowSeen.values()],
    colKeys: [...colSeen.values()],
    cells,
    rowTotals,
    colTotals,
    grand,
    agg,
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

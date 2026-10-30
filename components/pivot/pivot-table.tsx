"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import type { Field, PivotSpec } from "@/lib/pivot/types"
import { aggAt, compareKeys, compareValues, keyStr, type Key, type PivotGrid } from "@/lib/pivot/transform"
import { fieldLabel, formatMember, formatValue, grainLabel, valueLabel } from "./labels"
import { currentLocale, t } from "@/lib/i18n/client"

export type SortState =
  | { by: "label"; dir: "asc" | "desc" }
  | { by: "value"; colKey: string; valueIdx: number; total: boolean; dir: "asc" | "desc" }

const RENDER_STEP = 1000

interface Props {
  /** "r, g, b" of the sheet theme. */
  heatColor?: string
  grid: PivotGrid
  spec: PivotSpec
  fields: Map<string, Field>
  heatmap: boolean
  sort: SortState
  onSort: (s: SortState) => void
}

export function dimHeader(spec: PivotSpec, fields: Map<string, Field>, axis: "rows" | "columns", i: number) {
  const d = spec[axis][i]
  const f = fields.get(d.fieldId)
  return `${fieldLabel(f, d.fieldId)}${d.grain ? ` (${grainLabel(d.grain)})` : ""}`
}

export function sortedKeys(grid: PivotGrid, sort: SortState, subtotals = false): { rowKeys: Key[]; colKeys: Key[] } {
  const colKeys = [...grid.colKeys].sort(compareKeys)
  const rowKeys = [...grid.rowKeys]
  if (sort.by === "label") {
    rowKeys.sort((a, b) => (sort.dir === "asc" ? 1 : -1) * compareKeys(a, b))
  } else {
    const sortCol = sort.total ? [] : (colKeys.find((k) => keyStr(k) === sort.colKey) ?? [])
    const val = (rk: Key) => aggAt(grid, rk, sortCol)?.[sort.valueIdx]
    const byVal = (va: unknown, vb: unknown) => {
      if (va == null && vb == null) return 0
      if (va == null) return 1
      if (vb == null) return -1
      return (sort.dir === "asc" ? 1 : -1) * compareValues(Number(va), Number(vb))
    }
    rowKeys.sort((a, b) => {
      // With subtotals keep groups together, ordering each level by its subtotal.
      if (subtotals) {
        for (let d = 1; d < a.length; d++) {
          const pa = a.slice(0, d)
          const pb = b.slice(0, d)
          if (compareKeys(pa, pb) === 0) continue
          return byVal(val(pa), val(pb)) || compareKeys(pa, pb)
        }
      }
      return byVal(val(a), val(b)) || compareKeys(a, b)
    })
  }
  return { rowKeys, colKeys }
}

export type AxisItem = { kind: "leaf"; key: Key } | { kind: "sub"; key: Key }

/** Interleave subtotal entries (prefix keys) after each group of 2+ level axes. */
export function withSubtotals(keys: Key[], depth: number, enabled: boolean): AxisItem[] {
  const out: AxisItem[] = []
  if (!enabled || depth < 2) return keys.map((key) => ({ kind: "leaf", key }))
  const close = (prev: Key, next: Key | null) => {
    for (let d = depth - 1; d >= 1; d--) {
      const p = prev.slice(0, d)
      if (!next || compareKeys(p, next.slice(0, d)) !== 0) out.push({ kind: "sub", key: p })
    }
  }
  keys.forEach((k, i) => {
    out.push({ kind: "leaf", key: k })
    close(k, keys[i + 1] ?? null)
  })
  return out
}

export function PivotTable({ grid, spec, fields, heatmap, heatColor = "41, 181, 232", sort, onSort }: Props) {
  const [renderCount, setRenderCount] = useState(RENDER_STEP)
  const nr = spec.rows.length
  const nc = spec.columns.length
  const nv = spec.values.length
  const subtotals = Boolean(spec.subtotals) && nv > 0
  const showRowTotals = spec.totals && nc > 0 && nv > 0 && grid.rowTotals.size > 0
  const showColTotals = spec.totals && nr > 0 && nv > 0 && (grid.colTotals.size > 0 || grid.grand !== null)

  const { rowKeys, colKeys } = useMemo(() => sortedKeys(grid, sort, subtotals), [grid, sort, subtotals])
  const rowItems = useMemo(() => withSubtotals(rowKeys, nr, subtotals), [rowKeys, nr, subtotals])
  const colItems = useMemo(
    () => (nc > 0 ? withSubtotals(colKeys, nc, subtotals) : [{ kind: "leaf", key: [] } as AxisItem]),
    [colKeys, nc, subtotals],
  )
  const rowFamilies = spec.rows.map((d) => (d.grain ? "date" : fields.get(d.fieldId)?.family))
  const colFamilies = spec.columns.map((d) => (d.grain ? "date" : fields.get(d.fieldId)?.family))

  // Heatmap ranges per value index (detail cells only).
  const ranges = useMemo(() => {
    const r = Array.from({ length: nv }, () => ({ min: Infinity, max: -Infinity }))
    if (!heatmap) return r
    for (const vals of grid.cells.values()) {
      vals.forEach((v, i) => {
        const n = Number(v)
        if (v != null && Number.isFinite(n)) {
          r[i].min = Math.min(r[i].min, n)
          r[i].max = Math.max(r[i].max, n)
        }
      })
    }
    return r
  }, [grid, nv, heatmap])

  const heat = (v: unknown, i: number): React.CSSProperties | undefined => {
    if (!heatmap || v == null) return undefined
    const { min, max } = ranges[i]
    const n = Number(v)
    if (!Number.isFinite(n) || max <= min) return undefined
    const t = (n - min) / (max - min)
    return { backgroundColor: `rgba(${heatColor}, ${0.08 + t * 0.55})` }
  }

  const valueLabels = spec.values.map((v) => valueLabel(v, fields.get(v.fieldId)))
  const fmt = (v: unknown, i: number) => formatValue(v, fields.get(spec.values[i]?.fieldId))
  const rowHeaderCols = Math.max(nr, 1)

  const clickValueHeader = (colKey: string, valueIdx: number, total: boolean) => {
    if (sort.by === "value" && sort.colKey === colKey && sort.valueIdx === valueIdx && sort.total === total) {
      if (sort.dir === "desc") onSort({ ...sort, dir: "asc" })
      else onSort({ by: "label", dir: "asc" })
    } else onSort({ by: "value", colKey, valueIdx, total, dir: "desc" })
  }
  const sortIcon = (colKey: string, valueIdx: number, total: boolean) =>
    sort.by === "value" && sort.colKey === colKey && sort.valueIdx === valueIdx && sort.total === total ? (
      sort.dir === "desc" ? (
        <ArrowDown className="inline size-3" />
      ) : (
        <ArrowUp className="inline size-3" />
      )
    ) : null

  // Column header cells for one level, merging shared prefixes; a subtotal column
  // gets its own header at its depth spanning the remaining levels.
  const levelSpans = (level: number) => {
    const spans: { key: Key; span: number; sub: boolean }[] = []
    for (const it of colItems) {
      if (it.kind === "sub" && it.key.length < level) continue
      if (it.kind === "sub" && it.key.length === level) {
        spans.push({ key: it.key, span: 1, sub: true })
        continue
      }
      const prefix = it.key.slice(0, level + 1)
      const last = spans[spans.length - 1]
      if (last && !last.sub && keyStr(last.key) === keyStr(prefix)) last.span++
      else spans.push({ key: prefix, span: 1, sub: false })
    }
    return spans
  }

  const th = "border-b border-r border-border bg-muted px-2 py-1.5 text-left font-semibold whitespace-nowrap"
  const td = "border-b border-r border-border px-2 py-1 text-right tabular-nums whitespace-nowrap"
  const subTd = `${td} bg-muted/40 font-semibold`
  const visibleRows = rowItems.slice(0, renderCount)
  const blankRepeats = sort.by === "label"

  const valueCells = (rk: Key, rowIsSub: boolean) =>
    colItems.map((it) => {
      if (nv === 0) return null
      const vals = aggAt(grid, rk, it.key)
      const isSub = rowIsSub || it.kind === "sub"
      return spec.values.map((_, vi) => (
        <td
          key={`${it.kind}|${keyStr(it.key)}|${vi}`}
          className={isSub ? subTd : td}
          style={isSub ? undefined : heat(vals?.[vi], vi)}
        >
          {fmt(vals?.[vi], vi)}
        </td>
      ))
    })

  return (
    <div className="h-full overflow-auto">
      <table className="border-separate border-spacing-0 text-xs">
        <thead className="sticky top-0 z-20">
          {Array.from({ length: nc }, (_, level) => (
            <tr key={`h${level}`}>
              {level === 0 && (
                <th rowSpan={nc} colSpan={rowHeaderCols} className={`${th} sticky left-0 z-30 text-muted-foreground`}>
                  {spec.columns.map((_, i) => dimHeader(spec, fields, "columns", i)).join(" › ")}
                </th>
              )}
              {levelSpans(level).map(({ key, span, sub }) =>
                sub ? (
                  <th key={`s|${keyStr(key)}`} rowSpan={nc - level} colSpan={Math.max(nv, 1)} className={`${th} text-center italic`}>
                    {t("pt.subtotal")}
                  </th>
                ) : (
                  <th key={keyStr(key)} colSpan={span * Math.max(nv, 1)} className={`${th} text-center`}>
                    {formatMember(key[level], colFamilies[level])}
                  </th>
                ),
              )}
              {level === 0 && showRowTotals && (
                <th rowSpan={nc} colSpan={nv} className={`${th} text-center`}>
                  {t("pt.total")}
                </th>
              )}
            </tr>
          ))}
          {(nv > 0 || nc === 0) && (
            <tr>
              {nr > 0 ? (
                spec.rows.map((_, i) => (
                  <th
                    key={`rh${i}`}
                    className={`${th} cursor-pointer ${i === 0 ? "sticky left-0 z-30" : ""}`}
                    onClick={() => onSort({ by: "label", dir: sort.by === "label" && sort.dir === "asc" ? "desc" : "asc" })}
                  >
                    {dimHeader(spec, fields, "rows", i)}{" "}
                    {i === 0 && sort.by === "label" && (sort.dir === "asc" ? <ArrowUp className="inline size-3" /> : <ArrowDown className="inline size-3" />)}
                  </th>
                ))
              ) : (
                <th className={`${th} sticky left-0 z-30`} />
              )}
              {colItems.map((it) =>
                spec.values.map((_, vi) =>
                  it.kind === "sub" ? (
                    <th key={`s|${keyStr(it.key)}|${vi}`} className={`${th} text-right`}>
                      {valueLabels[vi]}
                    </th>
                  ) : (
                    <th
                      key={`${keyStr(it.key)}|${vi}`}
                      className={`${th} cursor-pointer text-right`}
                      onClick={() => clickValueHeader(keyStr(it.key), vi, false)}
                    >
                      {valueLabels[vi]} {sortIcon(keyStr(it.key), vi, false)}
                    </th>
                  ),
                ),
              )}
              {showRowTotals &&
                spec.values.map((_, vi) => (
                  <th key={`tot|${vi}`} className={`${th} cursor-pointer text-right`} onClick={() => clickValueHeader("", vi, true)}>
                    {valueLabels[vi]} {sortIcon("", vi, true)}
                  </th>
                ))}
            </tr>
          )}
        </thead>
        <tbody>
          {visibleRows.map((item, ri) => {
            const rk = item.key
            const totalCells =
              showRowTotals &&
              spec.values.map((_, vi) => (
                <td key={`tot|${vi}`} className={`${td} bg-muted/50 font-semibold`}>
                  {fmt(aggAt(grid, rk, [])?.[vi], vi)}
                </td>
              ))
            if (item.kind === "sub") {
              const d = rk.length
              return (
                <tr key={`s|${keyStr(rk)}|${d}`} className="bg-muted/40 font-semibold">
                  {rk.map((m, i) => (
                    <td
                      key={i}
                      className={`border-b border-r border-border bg-muted px-2 py-1 whitespace-nowrap ${i === 0 ? "sticky left-0 z-10" : ""}`}
                    >
                      {formatMember(m, rowFamilies[i])}
                    </td>
                  ))}
                  <td colSpan={nr - d} className="border-b border-r border-border bg-muted px-2 py-1 whitespace-nowrap italic">
                    {t("pt.subtotal")}
                  </td>
                  {valueCells(rk, true)}
                  {totalCells}
                </tr>
              )
            }
            const prevItem = ri > 0 ? visibleRows[ri - 1] : null
            const prev = prevItem?.kind === "leaf" ? prevItem.key : null
            return (
              <tr key={keyStr(rk)} className="hover:bg-accent/60">
                {nr > 0 ? (
                  rk.map((m, i) => {
                    const repeat = blankRepeats && prev && rk.slice(0, i + 1).every((x, j) => x === prev[j])
                    return (
                      <td
                        key={i}
                        className={`border-b border-r border-border bg-background px-2 py-1 whitespace-nowrap ${
                          i === 0 ? "sticky left-0 z-10 font-medium" : ""
                        } ${repeat ? "text-transparent" : ""}`}
                      >
                        {formatMember(m, rowFamilies[i])}
                      </td>
                    )
                  })
                ) : (
                  <td className="sticky left-0 z-10 border-b border-r border-border bg-background px-2 py-1 font-medium">
                    {nv > 0 ? t("pt.total") : ""}
                  </td>
                )}
                {valueCells(rk, false)}
                {totalCells}
              </tr>
            )
          })}
        </tbody>
        {showColTotals && (
          <tfoot className="sticky bottom-0 z-20">
            <tr>
              <td colSpan={rowHeaderCols} className="sticky left-0 z-30 border-t-2 border-r border-border bg-muted px-2 py-1.5 font-semibold">
                {t("pt.total")}
              </td>
              {colItems.map((it) =>
                spec.values.map((_, vi) => {
                  const vals = nc > 0 ? aggAt(grid, [], it.key) : grid.grand
                  return (
                    <td key={`${it.kind}|${keyStr(it.key)}|${vi}`} className={`${td} border-t-2 bg-muted font-semibold`}>
                      {fmt(vals?.[vi], vi)}
                    </td>
                  )
                }),
              )}
              {showRowTotals &&
                spec.values.map((_, vi) => (
                  <td key={`g|${vi}`} className={`${td} border-t-2 bg-muted font-bold`}>
                    {fmt(grid.grand?.[vi], vi)}
                  </td>
                ))}
            </tr>
          </tfoot>
        )}
      </table>
      {rowItems.length > renderCount && (
        <div className="p-3">
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setRenderCount((c) => c + RENDER_STEP)}
          >
            {t("pt.showMore", { a: renderCount.toLocaleString(currentLocale()), b: rowItems.length.toLocaleString(currentLocale()) })}
          </button>
        </div>
      )}
    </div>
  )
}

/** Flatten the pivot into a 2-D string matrix (used for CSV export). */
export function pivotMatrix(grid: PivotGrid, spec: PivotSpec, fields: Map<string, Field>, sort: SortState): string[][] {
  const nr = spec.rows.length
  const nc = spec.columns.length
  const subtotals = Boolean(spec.subtotals) && spec.values.length > 0
  const { rowKeys, colKeys } = sortedKeys(grid, sort, subtotals)
  const rowItems = withSubtotals(rowKeys, nr, subtotals)
  const colItems: AxisItem[] = nc > 0 ? withSubtotals(colKeys, nc, subtotals) : [{ kind: "leaf", key: [] }]
  const valueLabels = spec.values.map((v) => valueLabel(v, fields.get(v.fieldId)))
  const rowHeads = spec.rows.map((_, i) => dimHeader(spec, fields, "rows", i))
  const withTotals = spec.totals && nc > 0 && grid.rowTotals.size > 0
  const colLabel = (it: AxisItem) => {
    const parts = it.key.map((m) => formatMember(m))
    if (it.kind === "sub") parts.push(t("pt.subtotal"))
    return parts.join(" / ")
  }
  const header = [
    ...rowHeads,
    ...colItems.flatMap((it) => valueLabels.map((vl) => (it.key.length ? `${colLabel(it)} | ${vl}` : vl))),
    ...(withTotals ? valueLabels.map((vl) => `${t("pt.total")} | ${vl}`) : []),
  ]
  const raw = (v: unknown) => (v == null ? "" : String(v))
  const body = rowItems.map((it) => {
    const rk = it.key
    const heads = rk.map((m) => formatMember(m))
    if (it.kind === "sub") heads.push(t("pt.subtotal"), ...Array(Math.max(0, nr - rk.length - 1)).fill(""))
    return [
      ...heads,
      ...colItems.flatMap((ci) => spec.values.map((_, vi) => raw(aggAt(grid, rk, ci.key)?.[vi]))),
      ...(withTotals ? spec.values.map((_, vi) => raw(aggAt(grid, rk, [])?.[vi])) : []),
    ]
  })
  return [header, ...body]
}

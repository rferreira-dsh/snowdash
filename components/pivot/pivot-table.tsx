"use client"

import { useMemo, useState } from "react"
import { ArrowDown, ArrowUp } from "lucide-react"
import type { Field, PivotSpec } from "@/lib/pivot/types"
import { cellKey, compareKeys, compareValues, keyStr, type Key, type PivotGrid } from "@/lib/pivot/transform"
import { fieldLabel, formatMember, formatValue, grainLabel, valueLabel } from "./labels"
import { currentLocale, t } from "@/lib/i18n/client"

export type SortState =
  | { by: "label"; dir: "asc" | "desc" }
  | { by: "value"; colKey: string; valueIdx: number; total: boolean; dir: "asc" | "desc" }

const RENDER_STEP = 1000

interface Props {
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

export function sortedKeys(grid: PivotGrid, sort: SortState): { rowKeys: Key[]; colKeys: Key[] } {
  const colKeys = [...grid.colKeys].sort(compareKeys)
  const rowKeys = [...grid.rowKeys]
  if (sort.by === "label") {
    rowKeys.sort((a, b) => (sort.dir === "asc" ? 1 : -1) * compareKeys(a, b))
  } else {
    const val = (rk: Key) => {
      const arr = sort.total ? grid.rowTotals.get(keyStr(rk)) : grid.cells.get(keyStr(rk) + "\u0001\u0001" + sort.colKey)
      return arr?.[sort.valueIdx]
    }
    rowKeys.sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (va == null && vb == null) return compareKeys(a, b)
      if (va == null) return 1
      if (vb == null) return -1
      return (sort.dir === "asc" ? 1 : -1) * compareValues(Number(va), Number(vb))
    })
  }
  return { rowKeys, colKeys }
}

export function PivotTable({ grid, spec, fields, heatmap, sort, onSort }: Props) {
  const [renderCount, setRenderCount] = useState(RENDER_STEP)
  const nr = spec.rows.length
  const nc = spec.columns.length
  const nv = spec.values.length
  const showRowTotals = spec.totals && nc > 0 && nv > 0 && grid.rowTotals.size > 0
  const showColTotals = spec.totals && nr > 0 && nv > 0 && (grid.colTotals.size > 0 || grid.grand !== null)

  const { rowKeys, colKeys } = useMemo(() => sortedKeys(grid, sort), [grid, sort])
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
    return { backgroundColor: `rgba(41, 181, 232, ${0.08 + t * 0.55})` }
  }

  const valueLabels = spec.values.map((v) => valueLabel(v, fields.get(v.fieldId)))
  const fmt = (v: unknown, i: number) => formatValue(v, fields.get(spec.values[i]?.fieldId))
  const leafCols = nc > 0 ? colKeys : [[] as Key]
  const headerRows = nc + (nv > 0 ? 1 : 0) || 1
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

  // Column header levels with colspans merged on shared prefixes.
  const levelSpans = (level: number) => {
    const spans: { key: Key; span: number }[] = []
    for (const ck of colKeys) {
      const prefix = ck.slice(0, level + 1)
      const last = spans[spans.length - 1]
      if (last && keyStr(last.key) === keyStr(prefix)) last.span++
      else spans.push({ key: prefix, span: 1 })
    }
    return spans
  }

  const th = "border-b border-r border-border bg-muted px-2 py-1.5 text-left font-semibold whitespace-nowrap"
  const td = "border-b border-r border-border px-2 py-1 text-right tabular-nums whitespace-nowrap"
  const visibleRows = rowKeys.slice(0, renderCount)
  const blankRepeats = sort.by === "label"

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
              {levelSpans(level).map(({ key, span }) => (
                <th key={keyStr(key)} colSpan={span * Math.max(nv, 1)} className={`${th} text-center`}>
                  {formatMember(key[level], colFamilies[level])}
                </th>
              ))}
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
              {leafCols.map((ck) =>
                spec.values.map((_, vi) => (
                  <th
                    key={`${keyStr(ck)}|${vi}`}
                    className={`${th} cursor-pointer text-right`}
                    onClick={() => clickValueHeader(keyStr(ck), vi, false)}
                  >
                    {valueLabels[vi]} {sortIcon(keyStr(ck), vi, false)}
                  </th>
                )),
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
          {visibleRows.map((rk, ri) => {
            const prev = ri > 0 ? visibleRows[ri - 1] : null
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
                {leafCols.map((ck) => {
                  const vals = grid.cells.get(cellKey(rk, ck))
                  if (nv === 0) return null
                  return spec.values.map((_, vi) => (
                    <td key={`${keyStr(ck)}|${vi}`} className={td} style={heat(vals?.[vi], vi)}>
                      {fmt(vals?.[vi], vi)}
                    </td>
                  ))
                })}
                {showRowTotals &&
                  spec.values.map((_, vi) => (
                    <td key={`tot|${vi}`} className={`${td} bg-muted/50 font-semibold`}>
                      {fmt(grid.rowTotals.get(keyStr(rk))?.[vi], vi)}
                    </td>
                  ))}
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
              {leafCols.map((ck) =>
                spec.values.map((_, vi) => {
                  const vals = nc > 0 ? grid.colTotals.get(keyStr(ck)) : grid.grand
                  return (
                    <td key={`${keyStr(ck)}|${vi}`} className={`${td} border-t-2 bg-muted font-semibold`}>
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
      {rowKeys.length > renderCount && (
        <div className="p-3">
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setRenderCount((c) => c + RENDER_STEP)}
          >
            {t("pt.showMore", { a: renderCount.toLocaleString(currentLocale()), b: rowKeys.length.toLocaleString(currentLocale()) })}
          </button>
        </div>
      )}
    </div>
  )
}

/** Flatten the pivot into a 2-D string matrix (used for CSV export). */
export function pivotMatrix(grid: PivotGrid, spec: PivotSpec, fields: Map<string, Field>, sort: SortState): string[][] {
  const { rowKeys, colKeys } = sortedKeys(grid, sort)
  const nc = spec.columns.length
  const leafCols = nc > 0 ? colKeys : [[] as Key]
  const valueLabels = spec.values.map((v) => valueLabel(v, fields.get(v.fieldId)))
  const rowHeads = spec.rows.map((_, i) => dimHeader(spec, fields, "rows", i))
  const withTotals = spec.totals && nc > 0 && grid.rowTotals.size > 0
  const header = [
    ...rowHeads,
    ...leafCols.flatMap((ck) =>
      valueLabels.map((vl) => (ck.length ? `${ck.map((m) => formatMember(m)).join(" / ")} | ${vl}` : vl)),
    ),
    ...(withTotals ? valueLabels.map((vl) => `${t("pt.total")} | ${vl}`) : []),
  ]
  const raw = (v: unknown) => (v == null ? "" : String(v))
  const body = rowKeys.map((rk) => [
    ...rk.map((m) => formatMember(m)),
    ...leafCols.flatMap((ck) => spec.values.map((_, vi) => raw(grid.cells.get(cellKey(rk, ck))?.[vi]))),
    ...(withTotals ? spec.values.map((_, vi) => raw(grid.rowTotals.get(keyStr(rk))?.[vi])) : []),
  ])
  return [header, ...body]
}

"use client"

import { useMemo } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { Field, PivotSpec } from "@/lib/pivot/types"
import { cellKey, type PivotGrid } from "@/lib/pivot/transform"
import { ChartTooltip, formatTick, getYAxisWidth } from "@/components/chart-utils"
import { formatMember, valueLabel } from "./labels"
import { getLang, t } from "@/lib/i18n/client"
import { sortedKeys, type SortState } from "./pivot-table"

export type ChartKind = "bar" | "stacked" | "line" | "area"

const PALETTE = ["#29b5e8", "#11567f", "#ff9f36", "#7d44cf", "#2ca58d", "#d45b90", "#8a8a8a", "#e8c547", "#5b8def", "#71d3dc"]
const MAX_CATEGORIES = 300
const MAX_SERIES = 30

interface Props {
  palette?: string[]
  grid: PivotGrid
  spec: PivotSpec
  fields: Map<string, Field>
  kind: ChartKind
  sort: SortState
}

export function PivotChart({ grid, spec, fields, kind, sort, palette = PALETTE }: Props) {
  const { data, series, clipped } = useMemo(() => {
    const { rowKeys, colKeys } = sortedKeys(grid, sort)
    const vLabels = spec.values.map((v) => valueLabel(v, fields.get(v.fieldId)))
    const nr = spec.rows.length
    const series: { key: string; label: string }[] = []
    const rows: Record<string, unknown>[] = []

    if (nr > 0) {
      const cks = spec.columns.length ? colKeys : [[]]
      cks.forEach((ck, ci) =>
        vLabels.forEach((vl, vi) =>
          series.push({
            key: `s${ci}_${vi}`,
            label: ck.length ? `${ck.map((m) => formatMember(m)).join(" / ")}${vLabels.length > 1 ? ` · ${vl}` : ""}` : vl,
          }),
        ),
      )
      for (const rk of rowKeys.slice(0, MAX_CATEGORIES)) {
        const o: Record<string, unknown> = { __cat: rk.map((m) => formatMember(m)).join(" / ") }
        cks.forEach((ck, ci) => {
          const vals = grid.cells.get(cellKey(rk, ck))
          vLabels.forEach((_, vi) => (o[`s${ci}_${vi}`] = vals?.[vi] == null ? null : Number(vals[vi])))
        })
        rows.push(o)
      }
    } else {
      // No row dims: columns become the categories, values become series.
      vLabels.forEach((vl, vi) => series.push({ key: `s0_${vi}`, label: vl }))
      for (const ck of colKeys.slice(0, MAX_CATEGORIES)) {
        const vals = grid.cells.get(cellKey([], ck))
        const o: Record<string, unknown> = { __cat: ck.map((m) => formatMember(m)).join(" / ") || t("pt.total") }
        vLabels.forEach((_, vi) => (o[`s0_${vi}`] = vals?.[vi] == null ? null : Number(vals[vi])))
        rows.push(o)
      }
    }
    return {
      data: rows,
      series: series.slice(0, MAX_SERIES),
      clipped: rowKeys.length > MAX_CATEGORIES || series.length > MAX_SERIES,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, spec, fields, sort, getLang()])

  if (spec.values.length === 0) {
    return <Empty>{t("chart.needValue")}</Empty>
  }
  if (data.length === 0) return <Empty>{t("chart.noData")}</Empty>

  const yWidth = Math.max(...series.map((s) => getYAxisWidth(data, s.key)), 40)
  const common = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
      <XAxis dataKey="__cat" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} interval="preserveStartEnd" minTickGap={8} />
      <YAxis width={yWidth} tickFormatter={formatTick} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
      <Tooltip content={<ChartTooltip />} />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
    </>
  )
  const color = (i: number) => palette[i % palette.length]

  return (
    <div className="flex h-full flex-col p-3">
      {clipped && (
        <p className="mb-2 text-[11px] text-muted-foreground">
          {t("chart.clipped", { c: MAX_CATEGORIES, s: MAX_SERIES })}
        </p>
      )}
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          {kind === "line" ? (
            <LineChart data={data}>
              {common}
              {series.map((s, i) => (
                <Line key={s.key} dataKey={s.key} name={s.label} stroke={color(i)} dot={false} strokeWidth={2} connectNulls={false} />
              ))}
            </LineChart>
          ) : kind === "area" ? (
            <AreaChart data={data}>
              {common}
              {series.map((s, i) => (
                <Area key={s.key} dataKey={s.key} name={s.label} stackId="a" stroke={color(i)} fill={color(i)} fillOpacity={0.35} />
              ))}
            </AreaChart>
          ) : (
            <BarChart data={data}>
              {common}
              {series.map((s, i) => (
                <Bar key={s.key} dataKey={s.key} name={s.label} fill={color(i)} stackId={kind === "stacked" ? "a" : undefined} />
              ))}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{children}</div>
}


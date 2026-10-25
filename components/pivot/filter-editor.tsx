"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import type { Field, FilterOp, FilterRef, Source } from "@/lib/pivot/types"
import { Button } from "@/components/ui/button"
import { fieldLabel, formatMember } from "./labels"
import { t } from "@/lib/i18n/client"

const SYMBOL: Partial<Record<FilterOp, string>> = { eq: "=", neq: "≠", gt: ">", gte: "≥", lt: "<", lte: "≤" }
const opLabel = (op: FilterOp) => SYMBOL[op] ?? t(`op.${op}`)

function opsFor(f: Field): FilterOp[] {
  if (f.family === "number" || f.family === "date")
    return ["in", "not_in", "eq", "neq", "gt", "gte", "lt", "lte", "between", "is_null", "not_null"]
  return ["in", "not_in", "eq", "neq", "contains", "is_null", "not_null"]
}

export function describeFilter(flt: FilterRef, f: Field | undefined): string {
  const name = fieldLabel(f, flt.fieldId)
  const vals = flt.values.map((v) => formatMember(v, f?.family))
  switch (flt.op) {
    case "is_null":
    case "not_null":
      return `${name} ${opLabel(flt.op)}`
    case "in":
    case "not_in":
      if (vals.length === 0) return t("filter.all", { name })
      return `${name} ${flt.op === "not_in" ? "≠ " : ""}${vals.length <= 2 ? vals.join(", ") : t("filter.nValues", { n: vals.length })}`
    case "between":
      return t("filter.between", { name, a: vals[0] ?? "?", b: vals[1] ?? "?" })
    default:
      return `${name} ${opLabel(flt.op)} ${vals[0] ?? "?"}`
  }
}

interface Props {
  source: Source
  field: Field
  filter: FilterRef
  onApply: (f: FilterRef) => void
  onClose: () => void
}

export function FilterEditor({ source, field, filter, onApply, onClose }: Props) {
  const [op, setOp] = useState<FilterOp>(filter.op)
  const [selected, setSelected] = useState<Set<string>>(new Set(filter.values.map(String)))
  const [a, setA] = useState(String(filter.values[0] ?? ""))
  const [b, setB] = useState(String(filter.values[1] ?? ""))
  const [search, setSearch] = useState("")
  const [debounced, setDebounced] = useState("")

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  const listMode = op === "in" || op === "not_in"
  const values = useQuery({
    queryKey: ["values", source, field.id, debounced],
    enabled: listMode,
    staleTime: 120_000,
    queryFn: async () => {
      const r = await fetch("/api/values", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source, fieldId: field.id, search: debounced }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      return j.values as unknown[]
    },
  })

  const options = useMemo(() => {
    const vals = (values.data ?? []).filter((v) => v !== null && v !== undefined).map(String)
    // keep already-selected values visible even if outside the current search
    for (const s of selected) if (!vals.includes(s)) vals.unshift(s)
    return vals
  }, [values.data, selected])

  const toggle = (v: string) =>
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(v)) n.delete(v)
      else n.add(v)
      return n
    })

  const apply = () => {
    const cast = (v: string) => (field.family === "number" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : v)
    let vals: (string | number)[] = []
    if (listMode) vals = [...selected].map(cast)
    else if (op === "between") vals = [cast(a), cast(b)]
    else if (op !== "is_null" && op !== "not_null") vals = [cast(a)]
    onApply({ fieldId: field.id, op, values: vals })
    onClose()
  }

  const inputType = field.family === "number" ? "number" : field.family === "date" ? "date" : "text"
  const inputCls =
    "h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"

  return (
    <div className="w-72 space-y-2 p-2" onClick={(e) => e.stopPropagation()}>
      <div className="text-xs font-semibold">{fieldLabel(field, field.id)}</div>
      <select className={inputCls} value={op} onChange={(e) => setOp(e.target.value as FilterOp)}>
        {opsFor(field).map((o) => (
          <option key={o} value={o}>
            {opLabel(o)}
          </option>
        ))}
      </select>

      {listMode && (
        <>
          <input className={inputCls} placeholder={t("filter.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-56 overflow-auto rounded border border-border">
            {values.isLoading && <p className="p-2 text-xs text-muted-foreground">{t("catalog.loading")}</p>}
            {values.error && <p className="p-2 text-xs text-destructive">{values.error.message}</p>}
            {options.map((v) => (
              <label key={v} className="flex cursor-pointer items-center gap-2 px-2 py-1 text-xs hover:bg-accent">
                <input type="checkbox" checked={selected.has(v)} onChange={() => toggle(v)} />
                <span className="truncate">{formatMember(v, field.family)}</span>
              </label>
            ))}
            {!values.isLoading && options.length === 0 && <p className="p-2 text-xs text-muted-foreground">{t("filter.noValues")}</p>}
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{t("filter.selected", { n: selected.size })}</span>
            <button type="button" className="hover:underline" onClick={() => setSelected(new Set())}>
              {t("filter.clear")}
            </button>
          </div>
        </>
      )}

      {!listMode && op !== "is_null" && op !== "not_null" && (
        <div className="flex gap-2">
          <input className={inputCls} type={inputType} value={a} onChange={(e) => setA(e.target.value)} />
          {op === "between" && <input className={inputCls} type={inputType} value={b} onChange={(e) => setB(e.target.value)} />}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onClose}>
          {t("filter.cancel")}
        </Button>
        <Button size="sm" onClick={apply}>
          {t("filter.apply")}
        </Button>
      </div>
    </div>
  )
}

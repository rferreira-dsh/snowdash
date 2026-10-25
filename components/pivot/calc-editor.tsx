"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Calculator, CheckCircle2, Loader2, Trash2, X } from "lucide-react"
import { CURRENCIES, type CalcFormat, type CalcMetric, type Field, type Source } from "@/lib/pivot/types"
import { t } from "@/lib/i18n/client"
import { FamilyIcon } from "./catalog-panel"

const TABLE_FUNCS = ["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT", "COUNT_ROWS", "IF", "COALESCE", "NULLIF", "ROUND", "ABS"]
const SV_FUNCS = ["IF", "COALESCE", "NULLIF", "ROUND", "ABS"]

interface Props {
  source: Source
  /** Real fields of the source (not calc pseudo-fields). */
  fields: Field[]
  initial: CalcMetric | null
  takenNames: string[]
  onSave: (c: CalcMetric) => void
  onDelete?: () => void
  onClose: () => void
}

const inputCls =
  "w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"

export function CalcEditor({ source, fields, initial, takenNames, onSave, onDelete, onClose }: Props) {
  const isSV = source.kind === "SEMANTIC_VIEW"
  const [name, setName] = useState(initial?.name ?? "")
  const [formula, setFormula] = useState(initial?.formula ?? "")
  const [format, setFormat] = useState<CalcFormat>(initial?.format ?? "number")
  const [decimals, setDecimals] = useState(initial?.decimals ?? 2)
  const [currency, setCurrency] = useState(initial?.currency ?? "BRL")
  const [check, setCheck] = useState<{ state: "idle" | "checking" | "ok" | "error"; sql?: string; error?: string }>({
    state: "idle",
  })
  const [fieldFilter, setFieldFilter] = useState("")
  const ta = useRef<HTMLTextAreaElement>(null)

  // Live validation (debounced) against the server-side parser.
  useEffect(() => {
    if (!formula.trim()) return setCheck({ state: "idle" })
    setCheck((c) => ({ ...c, state: "checking" }))
    const ctl = new AbortController()
    const h = setTimeout(async () => {
      try {
        const r = await fetch("/api/formula", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: { ...source, calcs: undefined }, formula }),
          signal: ctl.signal,
        })
        const j = await r.json()
        setCheck(r.ok ? { state: "ok", sql: j.sql } : { state: "error", error: j.error ?? `HTTP ${r.status}` })
      } catch (e) {
        if (!ctl.signal.aborted) setCheck({ state: "error", error: e instanceof Error ? e.message : String(e) })
      }
    }, 350)
    return () => {
      clearTimeout(h)
      ctl.abort()
    }
  }, [formula, source])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const usable = useMemo(() => {
    const q = fieldFilter.trim().toUpperCase()
    return fields
      .filter((f) => (isSV ? f.role === "metric" : true))
      .filter((f) => !q || f.name.toUpperCase().includes(q) || f.id.toUpperCase().includes(q))
  }, [fields, isSV, fieldFilter])

  const nameCount = useMemo(() => {
    const m = new Map<string, number>()
    fields.forEach((f) => m.set(f.name.toUpperCase(), (m.get(f.name.toUpperCase()) ?? 0) + 1))
    return m
  }, [fields])

  const insert = (text: string, caretBack = 0) => {
    const el = ta.current
    const start = el?.selectionStart ?? formula.length
    const end = el?.selectionEnd ?? formula.length
    const next = formula.slice(0, start) + text + formula.slice(end)
    setFormula(next)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const pos = start + text.length - caretBack
      el.setSelectionRange(pos, pos)
    })
  }
  const fieldToken = (f: Field) => `[${(nameCount.get(f.name.toUpperCase()) ?? 0) > 1 ? f.id : f.name}]`

  const trimmed = name.trim()
  const nameError = !trimmed
    ? t("calc.needName")
    : takenNames.some((n) => n.toUpperCase() === trimmed.toUpperCase())
      ? t("calc.dupName")
      : null
  const canSave = !nameError && check.state === "ok"

  const save = () => {
    if (!canSave) return
    onSave({
      id: initial?.id ?? Math.random().toString(36).slice(2, 10),
      name: trimmed,
      formula,
      format,
      decimals,
      ...(format === "currency" ? { currency } : {}),
    })
  }

  const examples = isSV
    ? ["[METRICA_A] / [METRICA_B]", "([METRICA_A] - [METRICA_B]) / [METRICA_B]"]
    : ["SUM([VALOR]) / COUNT_DISTINCT([PEDIDO])", "SUM(IF([STATUS] = 'F', [VALOR], 0)) / SUM([VALOR])", "(SUM([RECEITA]) - SUM([CUSTO])) / SUM([RECEITA])"]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Calculator className="size-4 text-violet-600" />
          <h2 className="text-sm font-semibold">{initial ? t("calc.editTitle") : t("calc.newTitle")}</h2>
          <button onClick={onClose} className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 gap-4 overflow-auto p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <label className="space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("calc.name")}</span>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                placeholder={t("calc.namePh")}
                className={`${inputCls} h-8`}
              />
            </label>

            <label className="space-y-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("calc.formula")}</span>
              <textarea
                ref={ta}
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && save()}
                maxLength={2000}
                rows={5}
                spellCheck={false}
                placeholder={t("calc.formulaPh")}
                className={`${inputCls} py-1.5 font-mono`}
              />
            </label>

            <div className="flex flex-wrap gap-1">
              {(isSV ? SV_FUNCS : TABLE_FUNCS).map((fn) => (
                <button
                  key={fn}
                  onClick={() => insert(fn === "COUNT_ROWS" ? "COUNT_ROWS()" : `${fn}()`, fn === "COUNT_ROWS" ? 0 : 1)}
                  className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] hover:bg-accent"
                >
                  {fn}
                </button>
              ))}
            </div>

            <div className="min-h-[3.5rem] rounded-md border border-border bg-muted/40 p-2 text-xs">
              {check.state === "idle" && <p className="text-muted-foreground">{isSV ? t("calc.helpSV") : t("calc.helpTable")}</p>}
              {check.state === "checking" && (
                <p className="flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="size-3 animate-spin" /> {t("calc.checking")}
                </p>
              )}
              {check.state === "error" && <p className="text-destructive">{check.error}</p>}
              {check.state === "ok" && (
                <>
                  <p className="mb-1 flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="size-3" /> {t("calc.valid")} · {t("calc.sql")}
                  </p>
                  <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">{check.sql}</pre>
                </>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("calc.format")}</span>
                <select value={format} onChange={(e) => setFormat(e.target.value as CalcFormat)} className={`${inputCls} h-8`}>
                  {(["number", "percent", "currency"] as const).map((f) => (
                    <option key={f} value={f}>
                      {t(`calc.fmt.${f}`)}
                    </option>
                  ))}
                </select>
              </label>
              {format === "currency" && (
                <label className="space-y-1">
                  <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("calc.currency")}</span>
                  <select value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${inputCls} h-8`}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="space-y-1">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("calc.decimals")}</span>
                <input
                  type="number"
                  min={0}
                  max={6}
                  value={decimals}
                  onChange={(e) => setDecimals(Math.min(6, Math.max(0, Number(e.target.value) || 0)))}
                  className={`${inputCls} h-8 w-20`}
                />
              </label>
            </div>

            <div className="text-[11px] text-muted-foreground">
              <span className="font-medium">{t("calc.examples")}:</span>
              {examples.map((x) => (
                <code key={x} className="ml-2 inline-block rounded bg-muted px-1 font-mono">
                  {x}
                </code>
              ))}
            </div>
          </div>

          <div className="flex w-60 shrink-0 flex-col">
            <span className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("calc.fields")}</span>
            <input
              value={fieldFilter}
              onChange={(e) => setFieldFilter(e.target.value)}
              placeholder={t("catalog.filterFields")}
              className={`${inputCls} mb-1 h-7`}
            />
            {isSV && <p className="mb-1 text-[10px] text-muted-foreground">{t("calc.svOnly")}</p>}
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border">
              {usable.map((f) => (
                <button
                  key={f.id}
                  onClick={() => insert(fieldToken(f))}
                  title={`${f.id} · ${f.dataType}`}
                  className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-accent"
                >
                  <FamilyIcon field={f} />
                  <span className="truncate">{f.name}</span>
                  {f.entity && <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{f.entity}</span>}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-3">
          {onDelete && (
            <button
              onClick={() => window.confirm(t("calc.confirmDelete", { name: initial?.name ?? "" })) && onDelete()}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="size-3.5" /> {t("calc.delete")}
            </button>
          )}
          {nameError && name !== "" && <span className="text-xs text-destructive">{nameError}</span>}
          <button onClick={onClose} className="ml-auto h-8 rounded-md border border-border px-3 text-xs hover:bg-accent">
            {t("filter.cancel")}
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {t("calc.save")}
          </button>
        </div>
      </div>
    </div>
  )
}

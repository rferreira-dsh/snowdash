"use client"

import { useEffect, useRef, useState } from "react"
import { SlidersHorizontal } from "lucide-react"
import { t } from "@/lib/i18n/client"
import type { FieldLimits, LimitsInfo } from "@/lib/pivot/types"

const KEYS = ["rows", "columns", "values"] as const

let cached: Promise<LimitsInfo | null> | null = null
function loadLimits(): Promise<LimitsInfo | null> {
  cached ??= fetch("/api/limits")
    .then((r) => (r.ok ? (r.json() as Promise<LimitsInfo>) : null))
    .catch(() => null)
  return cached
}

/**
 * "Limits" toolbar button: shows the max fields per shelf for the sheet and lets the user
 * edit them (up to the default, or up to the admin ceiling). The server clamps again.
 */
export function LimitsButton({
  value,
  used,
  onChange,
  className,
}: {
  value: FieldLimits | undefined
  used: FieldLimits
  onChange: (v: FieldLimits | undefined) => void
  className: string
}) {
  const [info, setInfo] = useState<LimitsInfo | null>(null)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadLimits().then(setInfo)
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  if (!info) return null
  const cap = info.admin ? info.max : info.default
  const eff: FieldLimits = { ...info.default }
  for (const k of KEYS) if (value?.[k]) eff[k] = Math.min(value[k], cap[k])
  const custom = KEYS.some((k) => eff[k] !== info.default[k])
  const over = KEYS.some((k) => used[k] > eff[k])

  const set = (k: (typeof KEYS)[number], n: number) => {
    const next = { ...eff, [k]: Math.max(1, Math.min(cap[k], Math.floor(n) || 1)) }
    onChange(KEYS.every((x) => next[x] === info.default[x]) ? undefined : next)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        className={className}
        onClick={() => setOpen((o) => !o)}
        title={t("lim.title")}
      >
        <SlidersHorizontal className="size-3.5" /> {t("lim.button")}
        <span className="tabular-nums">
          {eff.rows}/{eff.columns}/{eff.values}
        </span>
        {over && <span className="size-1.5 rounded-full bg-destructive" />}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-72 rounded-md border border-border bg-popover p-3 text-xs shadow-lg">
          <div className="mb-2 font-medium">{t("lim.title")}</div>
          <div className="space-y-2">
            {KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2">
                <span className="w-16">{t(`lim.${k}`)}</span>
                <input
                  type="number"
                  min={1}
                  max={cap[k]}
                  value={eff[k]}
                  onChange={(e) => set(k, Number(e.target.value))}
                  className="h-7 w-16 rounded-md border border-border bg-background px-1.5 tabular-nums"
                />
                <span className={used[k] > eff[k] ? "text-destructive" : "text-muted-foreground"}>
                  {t("lim.inUse", { n: used[k] })}
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3 space-y-0.5 text-muted-foreground">
            <div>{t("lim.default", { ...info.default })}</div>
            <div>{t("lim.max", { ...info.max })}</div>
            {!info.admin && <div>{t("lim.adminOnly")}</div>}
            <div>{t("lim.heavy")}</div>
          </div>
          {custom && (
            <button className="mt-2 text-primary hover:underline" onClick={() => onChange(undefined)}>
              {t("lim.reset")}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

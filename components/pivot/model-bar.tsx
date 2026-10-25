"use client"

import { Link2, Plus, Trash2, TriangleAlert, X } from "lucide-react"
import type { DataModel, Field, JoinType, ModelTable } from "@/lib/pivot/types"
import { t as tr } from "@/lib/i18n/client"

interface Props {
  model: DataModel
  fields: Field[] | undefined
  onChange: (m: DataModel) => void
  onRemove: (alias: string) => void
}

const sel =
  "h-6 rounded border border-input bg-background px-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"

export function ModelBar({ model, fields, onChange, onRemove }: Props) {
  const colsOf = (alias: string) => (fields ?? []).filter((f) => f.entity === alias).map((f) => f.name)

  const patchJoin = (i: number, join: NonNullable<ModelTable["join"]>) =>
    onChange({ tables: model.tables.map((t, j) => (j === i ? { ...t, join } : t)) })

  const missingKeys = model.tables.some((t, i) => i > 0 && !t.join?.pairs.length)

  return (
    <div className="border-b border-border bg-violet-500/5 px-3 py-2">
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        <Link2 className="size-3" /> {tr("model.title")}
        <span className="font-normal normal-case tracking-normal">
          {tr("model.hint")}
        </span>
      </div>
      <div className="flex flex-wrap items-start gap-2">
        {model.tables.map((t, i) => {
          const j = t.join
          return (
            <div key={t.alias} className="rounded-md border border-violet-500/40 bg-card px-2 py-1.5 text-xs">
              <div className="flex items-center gap-1.5">
                <span className="font-semibold">{t.alias}</span>
                {t.alias !== t.name && <span className="text-muted-foreground">({t.name})</span>}
                {i === 0 && <span className="rounded bg-violet-500/15 px-1 text-[10px] text-violet-700 dark:text-violet-300">{tr("model.base")}</span>}
                {i > 0 && (
                  <button className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive" onClick={() => onRemove(t.alias)} title={tr("model.remove")}>
                    <Trash2 className="size-3" />
                  </button>
                )}
              </div>
              {i > 0 && j && (
                <div className="mt-1 space-y-1">
                  <div className="flex items-center gap-1">
                    <select className={sel} value={j.type} onChange={(e) => patchJoin(i, { ...j, type: e.target.value as JoinType })}>
                      <option value="LEFT">LEFT JOIN</option>
                      <option value="INNER">INNER JOIN</option>
                    </select>
                    <span className="text-muted-foreground">{tr("model.with")}</span>
                    <select
                      className={sel}
                      value={j.toAlias}
                      onChange={(e) => patchJoin(i, { ...j, toAlias: e.target.value, pairs: [] })}
                    >
                      {model.tables.slice(0, i).map((o) => (
                        <option key={o.alias} value={o.alias}>
                          {o.alias}
                        </option>
                      ))}
                    </select>
                  </div>
                  {j.pairs.map((p, pi) => (
                    <div key={pi} className="flex items-center gap-1">
                      <select
                        className={sel}
                        value={p.left}
                        onChange={(e) => patchJoin(i, { ...j, pairs: j.pairs.map((x, k) => (k === pi ? { ...x, left: e.target.value } : x)) })}
                      >
                        {colsOf(j.toAlias).map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                      <span>=</span>
                      <select
                        className={sel}
                        value={p.right}
                        onChange={(e) => patchJoin(i, { ...j, pairs: j.pairs.map((x, k) => (k === pi ? { ...x, right: e.target.value } : x)) })}
                      >
                        {colsOf(t.alias).map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                      <button className="rounded p-0.5 text-muted-foreground hover:bg-accent" onClick={() => patchJoin(i, { ...j, pairs: j.pairs.filter((_, k) => k !== pi) })}>
                        <X className="size-3" />
                      </button>
                    </div>
                  ))}
                  <button
                    className="text-[11px] text-primary hover:underline disabled:opacity-50"
                    disabled={!fields}
                    onClick={() => {
                      const l = colsOf(j.toAlias)[0]
                      const r = colsOf(t.alias)[0]
                      if (l && r) patchJoin(i, { ...j, pairs: [...j.pairs, { left: l, right: r }] })
                    }}
                  >
                    {tr("model.addKey")}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {missingKeys && (
        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-destructive">
          <TriangleAlert className="size-3" /> {tr("model.missingKeys")}
        </p>
      )}
      {model.tables.length > 1 && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {tr("model.fanout")}
        </p>
      )}
    </div>
  )
}

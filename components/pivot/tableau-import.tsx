"use client"

/** Preview + options for importing a Tableau workbook (.twb) as a new, unsaved SnowBook. */

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, FileUp, Folder, Link2, Loader2, Sigma, Table2, X, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { t } from "@/lib/i18n/client"
import type { Source } from "@/lib/pivot/types"

export interface TableauImportResult {
  datasources: { name: string; caption: string; tables: number }[]
  datasource: string
  source: Source
  sheets: { id: string; name: string; spec: import("@/lib/pivot/types").PivotSpec; view: "table" | "chart"; chartKind: "bar" | "line" | "area"; heatmap: boolean }[]
  warehouse: string | null
  warnings: { code: string; vars?: Record<string, string | number> }[]
  errors: { code: string; vars?: Record<string, string | number> }[]
}

interface Props {
  fileName: string
  xml: string
  onClose: () => void
  onImport: (r: TableauImportResult, name: string) => void
}

const input =
  "h-7 w-full rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"

/** Translate an import warning; the calc reason and formula are shown inline. */
function msg(w: { code: string; vars?: Record<string, string | number> }) {
  const v = { ...(w.vars ?? {}) }
  if (typeof v.reason === "string") {
    const [r, arg] = v.reason.split(":")
    v.reason = t(`tb.r.${r}`, { name: arg ?? "" })
  }
  return t(`tb.w.${w.code}`, v)
}

export function TableauImport({ fileName, xml, onClose, onImport }: Props) {
  const [datasource, setDatasource] = useState<string | undefined>()
  const [dbMap, setDbMap] = useState<Record<string, string>>({})
  const [scMap, setScMap] = useState<Record<string, string>>({})
  const [result, setResult] = useState<TableauImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [name, setName] = useState(fileName.replace(/\.twb$/i, ""))
  // Database/schema names as written in the workbook (before any remap).
  const [origin, setOrigin] = useState<{ dbs: string[]; schemas: string[] } | null>(null)

  const run = async (ds = datasource, remap = { database: dbMap, schema: scMap }) => {
    setLoading(true)
    setError(null)
    try {
      const r = await fetch("/api/tableau/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ xml, datasource: ds, remap }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      setResult(j)
      return j as TableauImportResult
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void run(undefined, { database: {}, schema: {} }).then((r) => {
      if (!r) return
      const tables = r.source.model?.tables ?? []
      setOrigin({ dbs: [...new Set(tables.map((x) => x.database))], schemas: [...new Set(tables.map((x) => x.schema))] })
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const tables = result?.source.model?.tables ?? []
  const counts = useMemo(
    () => ({
      folders: result?.source.folders?.length ?? 0,
      calcs: result?.source.calcs?.length ?? 0,
      labels: Object.keys(result?.source.labels ?? {}).length,
      hidden: result?.source.hidden?.length ?? 0,
    }),
    [result],
  )
  const canImport = !!result && !result.errors.length && !loading && !!name.trim()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <FileUp className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">{t("tb.title")}</h2>
          <span className="truncate text-xs text-muted-foreground">{fileName}</span>
          <button className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent" onClick={onClose} aria-label={t("tb.cancel")}>
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="font-medium text-muted-foreground">{t("tb.bookName")}</span>
              <input className={input} value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </label>
            {result && result.datasources.length > 1 && (
              <label className="space-y-1">
                <span className="font-medium text-muted-foreground">{t("tb.datasource")}</span>
                <select
                  className={input}
                  value={result.datasource}
                  onChange={(e) => {
                    setDatasource(e.target.value)
                    void run(e.target.value)
                  }}
                >
                  {result.datasources.map((d) => (
                    <option key={d.name} value={d.name}>
                      {d.caption} ({t("book.tables", { n: d.tables })})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {origin && (
            <div className="rounded-md border border-border p-3">
              <div className="mb-2 font-medium">{t("tb.remap")}</div>
              <p className="mb-2 text-muted-foreground">{t("tb.remapHint")}</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                {origin.dbs.map((d) => (
                  <label key={"db" + d} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 truncate font-mono" title={d}>
                      DB {d} →
                    </span>
                    <input className={input} placeholder={d} value={dbMap[d] ?? ""} onChange={(e) => setDbMap((m) => ({ ...m, [d]: e.target.value }))} />
                  </label>
                ))}
                {origin.schemas.map((s) => (
                  <label key={"sc" + s} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 truncate font-mono" title={s}>
                      {t("tb.schema")} {s} →
                    </span>
                    <input className={input} placeholder={s} value={scMap[s] ?? ""} onChange={(e) => setScMap((m) => ({ ...m, [s]: e.target.value }))} />
                  </label>
                ))}
              </div>
              <button className="mt-2 text-primary hover:underline disabled:opacity-50" disabled={loading} onClick={() => void run()}>
                {t("tb.recheck")}
              </button>
            </div>
          )}

          {loading && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> {t("tb.checking")}
            </p>
          )}
          {error && <p className="text-destructive">{error}</p>}

          {result && (
            <>
              {result.errors.length > 0 && (
                <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3">
                  {result.errors.map((w, i) => (
                    <p key={i} className="flex items-start gap-1.5 text-destructive">
                      <XCircle className="mt-0.5 size-3.5 shrink-0" /> {msg(w)}
                    </p>
                  ))}
                </div>
              )}

              <div>
                <div className="mb-1 flex items-center gap-1.5 font-medium">
                  <Link2 className="size-3.5 text-violet-600" /> {t("tb.tables", { n: tables.length })}
                </div>
                <table className="w-full">
                  <tbody>
                    {tables.map((x) => (
                      <tr key={x.alias} className="border-t border-border/60 align-top">
                        <td className="py-1 pr-3 font-medium">{x.alias}</td>
                        <td className="py-1 pr-3 font-mono text-muted-foreground">
                          {x.database}.{x.schema}.{x.name}
                        </td>
                        <td className="py-1 font-mono text-muted-foreground">
                          {x.join
                            ? `${x.join.type} ← ${x.join.pairs.map((p) => `${x.join!.toAlias}.${p.left} = ${x.alias}.${p.right}`).join(" AND ")}`
                            : t("tb.base")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-4 text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Folder className="size-3.5 text-amber-600" /> {t("tb.folders", { n: counts.folders })}
                </span>
                <span className="flex items-center gap-1">
                  <Sigma className="size-3.5" /> {t("tb.calcs", { n: counts.calcs })}
                </span>
                <span>{t("tb.labels", { n: counts.labels })}</span>
                <span>{t("tb.hidden", { n: counts.hidden })}</span>
                {result.warehouse && <span>{t("tb.warehouse", { name: result.warehouse })}</span>}
              </div>

              <div>
                <div className="mb-1 flex items-center gap-1.5 font-medium">
                  <Table2 className="size-3.5 text-sky-600" /> {t("tb.sheets", { n: result.sheets.length })}
                </div>
                <ul className="grid grid-cols-2 gap-x-6 gap-y-0.5">
                  {result.sheets.map((s) => (
                    <li key={s.id} className="truncate">
                      <span className="font-medium">{s.name}</span>{" "}
                      <span className="text-muted-foreground">
                        {t("tb.sheetSummary", {
                          r: s.spec.rows.length,
                          c: s.spec.columns.length,
                          v: s.spec.values.length,
                          f: s.spec.filters.length,
                        })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {result.warnings.length > 0 && (
                <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                  <div className="mb-1 font-medium text-amber-700">{t("tb.warnings", { n: result.warnings.length })}</div>
                  {result.warnings.map((w, i) => (
                    <p key={i} className="flex items-start gap-1.5 text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span className="min-w-0 break-words">
                        {msg(w)}
                        {w.vars?.formula && <code className="ml-1 block whitespace-pre-wrap text-[10px] text-muted-foreground">{String(w.vars.formula)}</code>}
                      </span>
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
          <p className="text-[11px] text-muted-foreground">{t("tb.footer")}</p>
          <button className="ml-auto h-7 rounded-md border border-border px-3 text-xs hover:bg-accent" onClick={onClose}>
            {t("tb.cancel")}
          </button>
          <Button size="sm" disabled={!canImport} onClick={() => result && onImport(result, name.trim())}>
            {t("tb.import")}
          </Button>
        </div>
      </div>
    </div>
  )
}

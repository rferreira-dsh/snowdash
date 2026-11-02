"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Activity, Loader2, RefreshCw, X } from "lucide-react"
import { currentLocale, t } from "@/lib/i18n/client"

interface ServiceQuery {
  queryId: string
  warehouse: string | null
  status: string
  startTime: string
  minutes: number
  sql: string
}

interface CancelResult {
  queryId: string
  result: string
}

const HOURS = [1, 6, 24, 72, 167]

/**
 * Admin-only "Queries" panel: lists the service user's in-flight queries (running / queued)
 * and cancels the selected ones. Hidden unless /api/admin/me says the login is an admin.
 */
export function AdminQueriesButton() {
  const [admin, setAdmin] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => (r.ok ? r.json() : { admin: false }))
      .then((d) => setAdmin(Boolean(d.admin)))
      .catch(() => setAdmin(false))
  }, [])

  if (!admin) return null
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={t("adm.title")}
        className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
      >
        <Activity className="size-3.5" /> {t("adm.button")}
      </button>
      {open && createPortal(<AdminQueriesPanel onClose={() => setOpen(false)} />, document.body)}
    </>
  )
}

function AdminQueriesPanel({ onClose }: { onClose: () => void }) {
  const [hours, setHours] = useState(24)
  const [loading, setLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [serviceUser, setServiceUser] = useState<string | null>(null)
  const [queries, setQueries] = useState<ServiceQuery[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<CancelResult[] | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    setResults(null)
    try {
      const res = await fetch(`/api/admin/queries?hours=${hours}`)
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? res.statusText)
      setServiceUser(d.serviceUser)
      setQueries(d.queries)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const cancelSelected = async () => {
    if (!selected.size || !window.confirm(t("adm.confirm", { n: selected.size }))) return
    setCancelling(true)
    setError(null)
    try {
      const res = await fetch("/api/admin/queries/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queryIds: [...selected], hours }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? res.statusText)
      setResults([
        ...d.cancelled.map((c: CancelResult) => ({ queryId: c.queryId, result: c.result })),
        ...d.notFound.map((id: string) => ({ queryId: id, result: t("adm.notFound") })),
      ])
      const done = new Set<string>(d.cancelled.map((c: CancelResult) => c.queryId))
      setQueries((qs) => qs?.filter((q) => !done.has(q.queryId)) ?? null)
      setSelected(new Set())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setCancelling(false)
    }
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const allSelected = !!queries?.length && selected.size === queries.length
  const fmtTime = (iso: string) => new Date(iso).toLocaleString(currentLocale())
  const th = "border-b border-border px-2 py-1.5 text-left font-semibold whitespace-nowrap"
  const td = "border-b border-border px-2 py-1 align-top truncate"

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-6" onClick={onClose}>
      <div
        className="flex max-h-full w-full max-w-5xl flex-col rounded-lg border border-border bg-background text-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Activity className="size-4" />
          <span className="text-sm font-semibold">{t("adm.title")}</span>
          {serviceUser && <span className="text-xs text-muted-foreground">· {t("adm.serviceUser", { user: serviceUser })}</span>}
          <button type="button" className="ml-auto rounded p-1 hover:bg-accent" onClick={onClose} aria-label={t("adm.close")}>
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
          <label className="flex items-center gap-1.5">
            {t("adm.window")}
            <select
              className="rounded border border-border bg-background px-1.5 py-0.5"
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              disabled={loading}
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {t("adm.hours", { h })}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 font-medium text-primary-foreground disabled:opacity-50"
            onClick={load}
            disabled={loading || cancelling}
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} {t("adm.search")}
          </button>
          {loading && <span className="text-muted-foreground">{t("adm.slow")}</span>}
          <button
            type="button"
            className="ml-auto flex items-center gap-1 rounded-md border border-destructive px-2.5 py-1 font-medium text-destructive hover:bg-destructive hover:text-white disabled:opacity-40"
            onClick={cancelSelected}
            disabled={!selected.size || cancelling || loading}
          >
            {cancelling && <Loader2 className="size-3.5 animate-spin" />} {t("adm.cancelSelected", { n: selected.size })}
          </button>
        </div>

        {error && <div className="mx-4 mb-2 rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
        {results && (
          <div className="mx-4 mb-2 rounded border border-border bg-muted/40 px-3 py-2 text-xs">
            {results.map((r) => (
              <div key={r.queryId} className="font-mono">
                {r.queryId}: {r.result}
              </div>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
          {queries === null ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t("adm.hint")}</p>
          ) : queries.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t("adm.none", { h: hours })}</p>
          ) : (
            <table className="w-full table-fixed border-separate border-spacing-0 text-xs">
              <colgroup>
                <col className="w-8" />
                <col className="w-24" />
                <col className="w-40" />
                <col className="w-14" />
                <col className="w-40" />
                <col />
              </colgroup>
              <thead className="sticky top-0 bg-muted">
                <tr>
                  <th className={th}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(queries.map((q) => q.queryId)))}
                      aria-label={t("adm.selectAll")}
                    />
                  </th>
                  <th className={th}>{t("adm.col.status")}</th>
                  <th className={th}>{t("adm.col.warehouse")}</th>
                  <th className={`${th} text-right`}>{t("adm.col.minutes")}</th>
                  <th className={th}>{t("adm.col.start")}</th>
                  <th className={th}>{t("adm.col.query")}</th>
                </tr>
              </thead>
              <tbody>
                {queries.map((q) => (
                  <tr key={q.queryId} className="hover:bg-accent/60 cursor-pointer" onClick={() => toggle(q.queryId)}>
                    <td className={td}>
                      <input type="checkbox" checked={selected.has(q.queryId)} onChange={() => toggle(q.queryId)} onClick={(e) => e.stopPropagation()} />
                    </td>
                    <td className={td}>{q.status}</td>
                    <td className={td}>{q.warehouse ?? "—"}</td>
                    <td className={`${td} text-right tabular-nums`}>{q.minutes.toLocaleString(currentLocale())}</td>
                    <td className={td}>{fmtTime(q.startTime)}</td>
                    <td className="border-b border-border px-2 py-1 align-top">
                      <div className="line-clamp-2 break-all font-mono" title={q.sql}>
                        {q.sql}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground">{q.queryId}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}

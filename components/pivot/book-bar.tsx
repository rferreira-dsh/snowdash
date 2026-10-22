"use client"

import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { BookOpen, ChevronDown, Copy, FilePlus2, Info, Link2, Loader2, Save, Search, Sparkles, Table2, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { currentLocale, t } from "@/lib/i18n/client"
import type { BookMeta } from "./workbench"

interface BookSummary {
  id: string
  name: string
  description: string | null
  kind: string
  base: string
  tables: number
  sheets: number
  updatedBy: string | null
  updatedAt: string | null
}

interface Props {
  book: BookMeta | null
  dirty: boolean
  saving: boolean
  canSave: boolean
  onRename: (name: string) => void
  onSave: () => void
  onSaveAs: () => void
  onOpen: (id: string) => void
  onNew: () => void
  onDelete: () => void
}

export function BookBar(p: Props) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState("")
  const ref = useRef<HTMLDivElement>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const infoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!infoOpen) return
    const onDoc = (e: MouseEvent) => infoRef.current && !infoRef.current.contains(e.target as Node) && setInfoOpen(false)
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [infoOpen])

  const list = useQuery({
    queryKey: ["snowbooks"],
    enabled: open,
    queryFn: async () => {
      const r = await fetch("/api/snowbooks")
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      return j as BookSummary[]
    },
  })

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const items = (list.data ?? []).filter((b) => !filter.trim() || b.name.toLowerCase().includes(filter.trim().toLowerCase()))
  const btn =
    "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground hover:bg-accent disabled:opacity-50"

  return (
    <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5">
      <BookOpen className="size-4 shrink-0 text-primary" />
      {p.book ? (
        <input
          value={p.book.name}
          onChange={(e) => p.onRename(e.target.value)}
          className="h-7 w-72 rounded-md border border-transparent bg-transparent px-1.5 text-sm font-semibold hover:border-border focus:border-input focus:outline-none focus:ring-2 focus:ring-ring"
          title={t("book.rename")}
        />
      ) : (
        <span className="text-sm text-muted-foreground">{t("book.unsaved")}</span>
      )}
      {p.dirty && <span className="size-2 rounded-full bg-amber-500" title={t("book.dirty")} />}
      {p.book?.updatedAt && (
        <div ref={infoRef} className="relative">
          <button
            className="rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            onClick={() => setInfoOpen((o) => !o)}
            title={t("book.info")}
            aria-label={t("book.info")}
          >
            <Info className="size-3.5" />
          </button>
          {infoOpen && (
            <div className="absolute left-0 top-8 z-50 w-64 rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-lg">
              <div className="mb-1 font-semibold">{p.book.name}</div>
              <div className="text-muted-foreground">
                {t("book.savedAt", { when: new Date(p.book.updatedAt).toLocaleString(currentLocale()) })}
                {p.book.updatedBy ? t("book.by", { user: p.book.updatedBy }) : ""}
              </div>
              {p.dirty && <div className="mt-1 text-amber-600">{t("book.dirty")}</div>}
            </div>
          )}
        </div>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        <Button size="sm" onClick={p.onSave} disabled={!p.canSave || p.saving || (!!p.book && !p.dirty)} title={t("book.saveTitle")}>
          {p.saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {t("book.save")}
        </Button>
        {p.book && (
          <button className={btn} onClick={p.onSaveAs} disabled={!p.canSave || p.saving} title={t("book.saveAsTitle")}>
            <Copy className="size-3.5" /> {t("book.saveAs")}
          </button>
        )}
        <div ref={ref} className="relative">
          <button className={btn} onClick={() => setOpen((o) => !o)}>
            <BookOpen className="size-3.5" /> {t("book.open")} <ChevronDown className="size-3" />
          </button>
          {open && (
            <div className="absolute right-0 top-8 z-50 w-96 rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg">
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  autoFocus
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t("book.search")}
                  className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
              <div className="max-h-80 overflow-auto">
                {list.isLoading && <p className="p-2 text-xs text-muted-foreground">{t("catalog.loading")}</p>}
                {list.error && <p className="p-2 text-xs text-destructive">{list.error.message}</p>}
                {!list.isLoading && items.length === 0 && <p className="p-2 text-xs text-muted-foreground">{t("book.none")}</p>}
                {items.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => {
                      setOpen(false)
                      p.onOpen(b.id)
                    }}
                    className={`flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-accent ${b.id === p.book?.id ? "bg-primary/10" : ""}`}
                  >
                    {b.kind === "MODEL" ? (
                      <Link2 className="mt-0.5 size-3.5 shrink-0 text-violet-600" />
                    ) : b.kind === "SEMANTIC_VIEW" ? (
                      <Sparkles className="mt-0.5 size-3.5 shrink-0 text-violet-600" />
                    ) : (
                      <Table2 className="mt-0.5 size-3.5 shrink-0 text-sky-600" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium">{b.name}</span>
                      <span className="block truncate text-[10px] text-muted-foreground">
                        {b.kind === "MODEL" ? t("book.tables", { n: b.tables }) : b.base} · {t("book.sheets", { n: b.sheets })}
                        {b.updatedAt ? ` · ${new Date(b.updatedAt).toLocaleDateString(currentLocale())}` : ""}
                        {b.updatedBy ? ` · ${b.updatedBy}` : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <button className={btn} onClick={p.onNew} title={t("book.newTitle")}>
          <FilePlus2 className="size-3.5" /> {t("book.new")}
        </button>
        {p.book && (
          <button className={`${btn} hover:text-destructive`} onClick={p.onDelete} title={t("book.deleteTitle")}>
            <Trash2 className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

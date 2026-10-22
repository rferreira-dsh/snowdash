"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Calendar, Database, Hash, Layers, Link2, Plus, Search, Sigma, Table2, Type, Eye, Sparkles, ToggleLeft } from "lucide-react"
import type { Field, Source, SourceKind } from "@/lib/pivot/types"
import { COUNT_ROWS_FIELD, fieldLabel } from "./labels"
import { currentLocale, t, useLang } from "@/lib/i18n/client"
import { DRAG_MIME, type DragPayload } from "./dnd"

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url)
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j as T
}

interface CatalogObject {
  name: string
  kind: SourceKind
  comment?: string
  rows?: number | null
}

const KIND_ICON: Record<SourceKind, React.ReactNode> = {
  TABLE: <Table2 className="size-3.5 shrink-0 text-sky-600" />,
  VIEW: <Eye className="size-3.5 shrink-0 text-amber-600" />,
  SEMANTIC_VIEW: <Sparkles className="size-3.5 shrink-0 text-violet-600" />,
  MODEL: <Link2 className="size-3.5 shrink-0 text-violet-600" />,
}

export function FamilyIcon({ field }: { field: Field }) {
  const cls = "size-3.5 shrink-0"
  if (field.role === "metric") return <Sigma className={`${cls} text-emerald-600`} />
  switch (field.family) {
    case "number":
      return <Hash className={`${cls} ${field.role === "measure" ? "text-emerald-600" : "text-sky-600"}`} />
    case "date":
      return <Calendar className={`${cls} text-sky-600`} />
    case "boolean":
      return <ToggleLeft className={`${cls} text-sky-600`} />
    default:
      return <Type className={`${cls} text-sky-600`} />
  }
}

const selectCls =
  "w-full h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"

interface Props {
  database: string
  schema: string
  source: Source | null
  onDatabase: (db: string) => void
  onSchema: (s: string) => void
  onSource: (s: Source) => void
  fields: Field[] | undefined
  fieldsLoading: boolean
  fieldsError: string | null
  onQuickAdd: (f: Field) => void
  /** Add a table/view to the current data model (join). */
  onAddToModel: (o: { database: string; schema: string; name: string }) => void
}

export function CatalogPanel(p: Props) {
  const { lang } = useLang()
  const [objFilter, setObjFilter] = useState("")
  const [fieldFilter, setFieldFilter] = useState("")

  const dbs = useQuery({
    queryKey: ["dbs"],
    queryFn: () => getJson<{ name: string; kind: string }[]>("/api/catalog?level=databases"),
    staleTime: 300_000,
  })
  const schemas = useQuery({
    queryKey: ["schemas", p.database],
    queryFn: () => getJson<string[]>(`/api/catalog?level=schemas&database=${encodeURIComponent(p.database)}`),
    enabled: !!p.database,
    staleTime: 300_000,
  })
  const objects = useQuery({
    queryKey: ["objects", p.database, p.schema],
    queryFn: () =>
      getJson<CatalogObject[]>(
        `/api/catalog?level=objects&database=${encodeURIComponent(p.database)}&schema=${encodeURIComponent(p.schema)}`,
      ),
    enabled: !!p.database && !!p.schema,
    staleTime: 300_000,
  })

  const visibleObjects = useMemo(() => {
    const q = objFilter.trim().toUpperCase()
    return (objects.data ?? []).filter((o) => !q || o.name.toUpperCase().includes(q))
  }, [objects.data, objFilter])

  const groups = useMemo(() => {
    const q = fieldFilter.trim().toUpperCase()
    const all = (p.fields ?? []).filter((f) => !q || f.name.toUpperCase().includes(q))
    const isSV = p.source?.kind === "SEMANTIC_VIEW"
    if (p.source?.kind === "MODEL") {
      const groups = (p.source.model?.tables ?? []).map((t) => ({
        title: t.alias,
        items: all
          .filter((f) => f.entity === t.alias)
          .sort((a, b) => Number(a.role !== "dimension") - Number(b.role !== "dimension")),
      }))
      if (!q || t("field.countRows").toUpperCase().includes(q)) groups.unshift({ title: t("catalog.general"), items: [COUNT_ROWS_FIELD] })
      return groups
    }
    const dims = all.filter((f) => f.role === "dimension")
    const meas = all.filter((f) => f.role !== "dimension")
    if (!isSV && (!q || t("field.countRows").toUpperCase().includes(q))) meas.unshift(COUNT_ROWS_FIELD)
    return [
      { title: t("catalog.dimensions"), items: dims },
      { title: isSV ? t("catalog.metrics") : t("catalog.measures"), items: meas },
    ]
  }, [p.fields, p.source, fieldFilter, lang])

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-border bg-card">
      <div className="space-y-2 border-b border-border p-3">
        <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Database className="size-3" /> {t("catalog.database")}
        </label>
        <select className={selectCls} value={p.database} onChange={(e) => p.onDatabase(e.target.value)}>
          <option value="">{dbs.isLoading ? t("catalog.loading") : t("catalog.select")}</option>
          {dbs.data?.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <Layers className="size-3" /> {t("catalog.schema")}
        </label>
        <select
          className={selectCls}
          value={p.schema}
          disabled={!p.database}
          onChange={(e) => p.onSchema(e.target.value)}
        >
          <option value="">{schemas.isLoading ? t("catalog.loading") : t("catalog.select")}</option>
          {schemas.data?.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {(dbs.error || schemas.error) && (
          <p className="text-xs text-destructive">{String((dbs.error ?? schemas.error)?.message)}</p>
        )}
      </div>

      {/* Objects */}
      <div className="flex min-h-0 basis-2/5 flex-col border-b border-border">
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("catalog.objects")}</span>
          <span className="ml-auto text-[11px] text-muted-foreground">{objects.data?.length ?? ""}</span>
        </div>
        <div className="px-3 pb-2">
          <SearchBox value={objFilter} onChange={setObjFilter} placeholder={t("catalog.filterObjects")} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-1.5 pb-2">
          {!p.schema && <p className="px-2 text-xs text-muted-foreground">{t("catalog.pickDbSchema")}</p>}
          {objects.isLoading && <p className="px-2 text-xs text-muted-foreground">{t("catalog.loading")}</p>}
          {objects.error && <p className="px-2 text-xs text-destructive">{objects.error.message}</p>}
          {visibleObjects.map((o) => {
            const inModel =
              p.source?.kind === "MODEL" &&
              !!p.source.model?.tables.some((t) => t.name === o.name && t.schema === p.schema && t.database === p.database)
            const active =
              inModel || (p.source?.name === o.name && p.source.kind === o.kind && p.source.schema === p.schema)
            const canAdd =
              o.kind !== "SEMANTIC_VIEW" && !!p.source && p.source.kind !== "SEMANTIC_VIEW" && !active
            return (
              <div
                key={o.kind + o.name}
                className={`group flex w-full items-center rounded hover:bg-accent ${active ? "bg-primary/15 font-medium text-foreground" : ""}`}
              >
                <button
                  title={o.comment ?? o.name}
                  onClick={() => p.onSource({ database: p.database, schema: p.schema, name: o.name, kind: o.kind })}
                  className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1 text-left text-xs"
                >
                  {KIND_ICON[o.kind]}
                  <span className="truncate">{o.name}</span>
                  {o.rows != null && (
                    <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                      {Intl.NumberFormat(currentLocale(), { notation: "compact" }).format(o.rows)}
                    </span>
                  )}
                </button>
                {canAdd && (
                  <button
                    title={t("catalog.joinTitle", { name: o.name })}
                    onClick={() => p.onAddToModel({ database: p.database, schema: p.schema, name: o.name })}
                    className="mr-1 rounded p-0.5 text-muted-foreground opacity-0 hover:bg-primary/20 hover:text-primary group-hover:opacity-100"
                  >
                    <Plus className="size-3.5" />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Fields */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {t("catalog.fields")} {p.source ? `· ${p.source.kind === "MODEL" ? t("catalog.fieldsModel", { n: p.source.model?.tables.length ?? 0 }) : p.source.name}` : ""}
        </div>
        <div className="px-3 pb-2">
          <SearchBox value={fieldFilter} onChange={setFieldFilter} placeholder={t("catalog.filterFields")} />
        </div>
        <div
          className="min-h-0 flex-1 overflow-auto px-1.5 pb-3"
          onDragOver={(e) => e.dataTransfer.types.includes(DRAG_MIME) && e.preventDefault()}
        >
          {!p.source && <p className="px-2 text-xs text-muted-foreground">{t("catalog.pickObject")}</p>}
          {p.fieldsLoading && <p className="px-2 text-xs text-muted-foreground">{t("catalog.loadingFields")}</p>}
          {p.fieldsError && <p className="px-2 text-xs text-destructive">{p.fieldsError}</p>}
          {p.source &&
            !p.fieldsLoading &&
            groups.map((g) => (
              <div key={g.title} className="mb-2">
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.title}
                </div>
                {g.items.map((f) => (
                  <FieldItem key={f.id} field={f} onDoubleClick={() => p.onQuickAdd(f)} />
                ))}
                {g.items.length === 0 && <p className="px-2 text-xs text-muted-foreground">—</p>}
              </div>
            ))}
        </div>
        <p className="border-t border-border px-3 py-2 text-[10px] leading-snug text-muted-foreground">
          {t("catalog.hint")}
        </p>
      </div>
    </aside>
  )
}

function FieldItem({ field, onDoubleClick }: { field: Field; onDoubleClick: () => void }) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        const payload: DragPayload = { fieldId: field.id }
        e.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload))
        e.dataTransfer.effectAllowed = "copyMove"
      }}
      onDoubleClick={onDoubleClick}
      title={[field.entity ? `${field.entity}.${field.name}` : field.name, field.dataType, field.description]
        .filter(Boolean)
        .join("\n")}
      className="flex cursor-grab select-none items-center gap-2 rounded px-2 py-1 text-xs hover:bg-accent active:cursor-grabbing"
    >
      <FamilyIcon field={field} />
      <span className="truncate">{fieldLabel(field, field.id)}</span>
      {field.entity && <span className="ml-auto shrink-0 truncate text-[10px] text-muted-foreground">{field.entity}</span>}
    </div>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 w-full rounded-md border border-input bg-background pl-7 pr-2 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
      />
    </div>
  )
}

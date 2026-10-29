"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftRight,
  BarChart3,
  Code2,
  Columns3,
  Download,
  Eraser,
  Filter,
  Flame,
  Link2,
  LineChart as LineIcon,
  Loader2,
  Play,
  Rows3,
  Sigma,
  Sparkles,
  Table2,
  Zap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CALC_PREFIX,
  COUNT_ROWS_ID,
  MAX_CALCS,
  type CalcMetric,
  DEFAULT_LIMIT,
  GRAINS,
  MAX_MODEL_TABLES,
  TABLE_AGGS,
  type Agg,
  type DataModel,
  type Field,
  type FilterRef,
  type PivotResponse,
  type PivotSpec,
  type Source,
} from "@/lib/pivot/types"
import { buildGrid } from "@/lib/pivot/transform"
import { setWarehouse, useWarehouse } from "@/lib/warehouse-client"
import { makeAlias, modelSource, removeTable, suggestJoin, tableToModel } from "@/lib/pivot/model"
import { ModelBar } from "./model-bar"
import { BookBar } from "./book-bar"
import { SheetTabs } from "./sheet-tabs"
import { CatalogPanel } from "./catalog-panel"
import { Shelf, MenuItem, MenuLabel, type PillItem } from "./shelf"
import { FilterEditor, describeFilter } from "./filter-editor"
import { PivotTable, pivotMatrix, dimHeader, type SortState } from "./pivot-table"
import { PivotChart, type ChartKind } from "./pivot-chart"
import { aggLabel, calcField, COUNT_ROWS_FIELD, fieldLabel, grainLabel, valueLabel } from "./labels"
import { prefixFolders, pruneFolders } from "@/lib/pivot/folders"
import { CalcEditor } from "./calc-editor"
import { theme as getTheme, themeForIndex } from "./themes"
import { currentLocale, t, useLang } from "@/lib/i18n/client"
import type { DragPayload, ShelfId } from "./dnd"

const STORAGE_KEY = "snowdash:v1"

const EMPTY_SPEC: PivotSpec = { rows: [], columns: [], values: [], filters: [], totals: true, limit: DEFAULT_LIMIT }

type Persisted = {
  database: string
  schema: string
  source: Source | null
  spec: PivotSpec
  /** Layout remembered per source, so switching objects never loses work. */
  layouts?: Record<string, PivotSpec>
  sheets?: SheetState[]
  activeId?: string
  book?: BookMeta | null
  savedSnapshot?: string | null
}

export interface SheetState {
  id: string
  name: string
  spec: PivotSpec
  view: "table" | "chart"
  chartKind: ChartKind
  heatmap: boolean
  /** Color theme id (tab accent, chart palette, heatmap). */
  theme?: string
}

export interface BookMeta {
  id: string
  name: string
  description?: string | null
  updatedAt?: string | null
  updatedBy?: string | null
}

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16)
      })

function newSheet(n: number, spec?: PivotSpec): SheetState {
  return { id: uid(), name: t("sheet.name", { n }), spec: spec ?? EMPTY_SPEC, view: "table", chartKind: "bar", heatmap: false, theme: themeForIndex(n) }
}

/** What counts as "the content" of a SnowBook, for unsaved-changes detection. */
function snapshot(name: string, source: Source | null, sheets: SheetState[]) {
  return JSON.stringify({ name, source, sheets: sheets.map(({ id, name, spec, view, chartKind, heatmap }) => ({ id, name, spec, view, chartKind, heatmap })) })
}

const sourceKey = (s: Source) =>
  [s.kind, s.database, s.schema, s.name, ...(s.model?.tables.map((t) => t.alias) ?? [])].join("|")

async function fetchFields(src: Source): Promise<Field[]> {
  const r = await fetch("/api/fields", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: src }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j
}

/** Field metadata only depends on which tables are in the source, not on join keys. */
function fieldsKey(s: Source | null) {
  if (!s) return null
  return [s.kind, s.database, s.schema, s.name, s.model?.tables.map((t) => [t.database, t.schema, t.name, t.alias].join(".")) ?? []]
}

/** Prefix plain-table field ids with the model alias when a table becomes a model. */
function prefixSpec(spec: PivotSpec, alias: string): PivotSpec {
  const p = (id: string) => (id === COUNT_ROWS_ID || id.startsWith(CALC_PREFIX) ? id : `${alias}.${id}`)
  return {
    ...spec,
    rows: spec.rows.map((d) => ({ ...d, fieldId: p(d.fieldId) })),
    columns: spec.columns.map((d) => ({ ...d, fieldId: p(d.fieldId) })),
    values: spec.values.map((v) => ({ ...v, fieldId: p(v.fieldId) })),
    filters: spec.filters.map((f) => ({ ...f, fieldId: p(f.fieldId) })),
  }
}

interface RunResult extends PivotResponse {
  spec: PivotSpec
}

async function runPivot(source: Source, spec: PivotSpec): Promise<RunResult> {
  const r = await fetch("/api/pivot", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, spec }),
  })
  const j = await r.json()
  if (!r.ok) {
    const err = new Error(j.error ?? `HTTP ${r.status}`) as Error & { sql?: string }
    err.sql = j.sql
    throw err
  }
  return { ...(j as PivotResponse), spec }
}

function defaultAgg(f: Field, isSV: boolean): Agg {
  if (f.calc) return "CALC"
  if (f.id === COUNT_ROWS_ID) return "COUNT"
  if (isSV) return "METRIC"
  return f.family === "number" && f.role === "measure" ? "SUM" : "COUNT_DISTINCT"
}

function aggsFor(f: Field): Agg[] {
  if (f.id === COUNT_ROWS_ID || f.calc) return []
  return f.family === "number" ? TABLE_AGGS : TABLE_AGGS.filter((a) => a !== "SUM" && a !== "AVG")
}

function specIsRunnable(spec: PivotSpec) {
  return spec.rows.length + spec.columns.length + spec.values.length > 0
}

export function Workbench() {
  useLang() // re-render the whole workbench when the language changes
  const [hydrated, setHydrated] = useState(false)
  const [database, setDatabase] = useState("")
  const [schema, setSchema] = useState("")
  const [source, setSource] = useState<Source | null>(null)
  const [sheets, setSheets] = useState<SheetState[]>(() => [newSheet(1)])
  const [activeId, setActiveId] = useState<string>(() => sheets[0].id)
  const [book, setBook] = useState<BookMeta | null>(null)
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null)
  const [auto, setAuto] = useState(true)
  const [runSpec, setRunSpec] = useState<PivotSpec | null>(null)
  const [showSql, setShowSql] = useState(false)
  const [showModel, setShowModel] = useState(true)
  const [sort, setSort] = useState<SortState>({ by: "label", dir: "asc" })
  const [notice, setNotice] = useState<string | null>(null)
  const [layouts, setLayouts] = useState<Record<string, PivotSpec>>({})
  const warehouse = useWarehouse()

  // ---- active sheet ----------------------------------------------------------
  const active = sheets.find((s) => s.id === activeId) ?? sheets[0]
  const spec = active.spec
  const { view, chartKind, heatmap } = active
  const sheetTheme = getTheme(active.theme)
  const patchActive = useCallback(
    (fn: (s: SheetState) => SheetState) => setSheets((ss) => ss.map((s) => (s.id === activeId ? fn(s) : s))),
    [activeId],
  )
  const setSpec = useCallback(
    (u: PivotSpec | ((p: PivotSpec) => PivotSpec)) =>
      patchActive((s) => {
        const next = typeof u === "function" ? u(s.spec) : u
        return next === s.spec ? s : { ...s, spec: next }
      }),
    [patchActive],
  )
  const setView = (v: "table" | "chart") => patchActive((s) => ({ ...s, view: v }))
  const setChartKind = (k: ChartKind) => patchActive((s) => ({ ...s, chartKind: k }))
  const setHeatmap = (fn: (h: boolean) => boolean) => patchActive((s) => ({ ...s, heatmap: fn(s.heatmap) }))

  const selectSheet = (id: string) => {
    if (id === activeId) return
    setActiveId(id)
    setRunSpec(null)
    setSort({ by: "label", dir: "asc" })
  }

  // ---- persistence (working state survives reloads, saved or not) -----------
  useEffect(() => {
    const apply = (saved: Persisted) => {
      setDatabase(saved.database ?? "")
      setSchema(saved.schema ?? "")
      setSource(saved.source ?? null)
      const ss = saved.sheets?.length
        ? saved.sheets.map((s) => ({ ...newSheet(1), ...s, spec: { ...EMPTY_SPEC, ...s.spec } }))
        : [{ ...newSheet(1), spec: { ...EMPTY_SPEC, ...saved.spec } }]
      setSheets(ss)
      setActiveId(ss.some((s) => s.id === saved.activeId) ? saved.activeId! : ss[0].id)
      setLayouts(saved.layouts ?? {})
      setBook(saved.book ?? null)
      setSavedSnapshot(saved.savedSnapshot ?? null)
    }
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Persisted | null
      if (saved) apply(saved)
    } catch {
      /* ignore corrupt state */
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const p: Persisted = { database, schema, source, spec, layouts, sheets, activeId, book, savedSnapshot }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  }, [hydrated, database, schema, source, spec, layouts, sheets, activeId, book, savedSnapshot])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 8000)
    return () => clearTimeout(t)
  }, [notice])

  // ---- metadata --------------------------------------------------------------
  const fieldsQ = useQuery({
    queryKey: ["fields", fieldsKey(source)],
    queryFn: () => fetchFields(source!),
    enabled: !!source,
    staleTime: 300_000,
  })
  const isSV = source?.kind === "SEMANTIC_VIEW"
  const calcFields = useMemo(() => (source?.calcs ?? []).map(calcField), [source?.calcs])
  const fieldMap = useMemo(() => {
    const m = new Map<string, Field>((fieldsQ.data ?? []).map((f) => [f.id, f]))
    m.set(COUNT_ROWS_ID, COUNT_ROWS_FIELD)
    calcFields.forEach((f) => m.set(f.id, f))
    return m
  }, [fieldsQ.data, calcFields])

  // Drop shelf items whose fields no longer exist (e.g. a table removed from the model) — in every sheet.
  useEffect(() => {
    if (!fieldsQ.data) return
    const ok = (id: string) => fieldMap.has(id) && !(isSV && id === COUNT_ROWS_ID)
    setSheets((ss) => {
      let changed = false
      const out = ss.map((sh) => {
        const s = sh.spec
        const next = {
          ...s,
          rows: s.rows.filter((d) => ok(d.fieldId)),
          columns: s.columns.filter((d) => ok(d.fieldId)),
          values: s.values.filter((v) => ok(v.fieldId)),
          filters: s.filters.filter((f) => ok(f.fieldId)),
        }
        if (JSON.stringify(next) === JSON.stringify(s)) return sh
        changed = true
        return { ...sh, spec: next }
      })
      return changed ? out : ss
    })
  }, [fieldsQ.data, fieldMap, isSV])

  // ---- query execution -------------------------------------------------------
  const modelReady = source?.kind !== "MODEL" || !!source.model?.tables.every((t, i) => i === 0 || t.join?.pairs.length)
  useEffect(() => {
    if (!auto || !fieldsQ.data) return
    const t = setTimeout(() => setRunSpec(specIsRunnable(spec) ? spec : null), 450)
    return () => clearTimeout(t)
  }, [auto, spec, fieldsQ.data])

  const result = useQuery({
    queryKey: ["pivot", source, runSpec, warehouse],
    queryFn: () => runPivot(source!, runSpec!),
    enabled: !!source && !!runSpec && !!fieldsQ.data && modelReady,
    staleTime: 60_000,
    retry: false,
  })

  const grid = useMemo(() => (result.data ? buildGrid(result.data.rows, result.data.spec) : null), [result.data])
  const stale = auto ? false : JSON.stringify(spec) !== JSON.stringify(runSpec)

  const runNow = () => {
    if (!specIsRunnable(spec)) return setNotice(t("n.needField"))
    if (JSON.stringify(spec) === JSON.stringify(runSpec)) result.refetch()
    else setRunSpec(spec)
  }

  // ---- source selection ------------------------------------------------------
  const chooseDatabase = (db: string) => {
    setDatabase(db)
    setSchema("")
  }
  const chooseSource = (s: Source) => {
    if (source && sourceKey(s) === sourceKey(source)) return
    // Inside a model (or with work on the shelves), clicking another table JOINS it instead of replacing.
    const joinable = s.kind !== "SEMANTIC_VIEW" && !!source && source.kind !== "SEMANTIC_VIEW"
    const hasWork = source?.kind === "MODEL" || sheets.some((sh) => specIsRunnable(sh.spec))
    if (joinable && hasWork) {
      const inModel = source!.model?.tables.some((t) => t.database === s.database && t.schema === s.schema && t.name === s.name)
      if (inModel) return setNotice(t("n.alreadyInModel", { name: s.name }))
      void addToModel(s)
      return
    }
    if (book || hasWork) {
      const msg = book
        ? t("n.switchCloses", { name: book.name, unsaved: dirty ? t("n.unsavedSuffix") : "" })
        : t("n.switchConfirm", { name: s.name })
      if (!window.confirm(msg)) return
    }
    const saved = layouts[sourceKey(s)]
    if (source) {
      const current = spec
      setLayouts((l) => ({ ...l, [sourceKey(source)]: current }))
    }
    const sh = { ...newSheet(1), spec: saved ?? { ...EMPTY_SPEC, totals: spec.totals, limit: spec.limit } }
    setSheets([sh])
    setActiveId(sh.id)
    setBook(null)
    setSavedSnapshot(null)
    setRunSpec(null)
    setSort({ by: "label", dir: "asc" })
    setSource(s)
  }

  // ---- data model (joins) ----------------------------------------------------
  const [adding, setAdding] = useState(false)
  const addToModel = async (o: { database: string; schema: string; name: string }) => {
    if (!source || source.kind === "SEMANTIC_VIEW" || !fieldsQ.data) return
    setAdding(true)
    try {
      let model: DataModel
      let modelFieldsNow: Field[]
      if (source.kind === "MODEL") {
        model = source.model!
        modelFieldsNow = fieldsQ.data
      } else {
        model = tableToModel(source)
        const alias = model.tables[0].alias
        modelFieldsNow = fieldsQ.data.map((f) => ({ ...f, id: `${alias}.${f.name}`, entity: alias }))
      }
      if (model.tables.length >= MAX_MODEL_TABLES) return setNotice(t("n.maxTables", { n: MAX_MODEL_TABLES }))
      if (source.kind !== "MODEL") {
        // Every sheet's field ids gain the base-table alias.
        const a = model.tables[0].alias
        setSheets((ss) => ss.map((sh) => ({ ...sh, spec: prefixSpec(sh.spec, a) })))
      }
      const alias = makeAlias(o.name, model.tables.map((t) => t.alias))
      const newCols = (await fetchFields({ ...o, kind: "TABLE" })).map((f) => ({ ...f, entity: alias }))
      const join = suggestJoin(model, modelFieldsNow, newCols) ?? { toAlias: model.tables[0].alias, type: "LEFT" as const, pairs: [] }
      const next: DataModel = { tables: [...model.tables, { ...o, alias, join }] }
      setNotice(
        join.pairs.length
          ? t("n.joined", { name: o.name, on: join.pairs.map((p) => `${join.toAlias}.${p.left} = ${alias}.${p.right}`).join(" AND ") })
          : t("n.noKey", { name: o.name }),
      )
      setShowModel(true)
      setSource({
        ...modelSource(next),
        calcs: source.calcs,
        folders: source.kind === "MODEL" ? source.folders : prefixFolders(source.folders, next.tables[0].alias),
      })
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("n.addFailed"))
    } finally {
      setAdding(false)
    }
  }
  const changeModel = (m: DataModel) => setSource({ ...modelSource(m), calcs: source?.calcs, folders: source?.folders })
  const removeFromModel = (alias: string) =>
    source?.model &&
    setSource({
      ...modelSource(removeTable(source.model, alias)),
      calcs: source.calcs,
      folders: source.folders && pruneFolders(source.folders, (id) => !id.startsWith(`${alias}.`)),
    })

  // ---- calculated metrics (live on the source, so they are saved with the SnowBook) ----
  const [calcEdit, setCalcEdit] = useState<CalcMetric | "new" | null>(null)
  const saveCalc = (c: CalcMetric) => {
    setSource((s) => {
      if (!s) return s
      const list = s.calcs ?? []
      if (list.length >= MAX_CALCS && !list.some((x) => x.id === c.id)) return s
      const calcs = list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]
      return { ...s, calcs }
    })
    setCalcEdit(null)
  }
  const deleteCalc = (id: string) => {
    setSource((s) =>
      s
        ? {
            ...s,
            calcs: (s.calcs ?? []).filter((x) => x.id !== id),
            folders: s.folders && pruneFolders(s.folders, (f) => f !== CALC_PREFIX + id),
          }
        : s,
    )
    setCalcEdit(null)
  }

  // ---- SnowBooks -------------------------------------------------------------
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const dirty = !!book && snapshot(book.name, source, sheets) !== savedSnapshot

  const setUrlBook = (id: string | null) => {
    const u = new URL(window.location.href)
    if (id) u.searchParams.set("book", id)
    else u.searchParams.delete("book")
    window.history.replaceState(null, "", u)
  }

  const saveBook = async (asNew = false) => {
    if (!source) return setNotice(t("n.pickSource"))
    let meta = book
    if (!meta || asNew) {
      const suggested = asNew && meta ? t("n.copySuffix", { name: meta.name }) : source.kind === "MODEL" ? t("n.modelName", { tables: source.model!.tables.map((x) => x.alias).join(" + ") }) : source.name
      const name = window.prompt(t("n.bookName"), suggested)?.trim()
      if (!name) return
      meta = { id: uid(), name }
    }
    setSaving(true)
    try {
      const r = await fetch(`/api/snowbooks/${meta.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        // The current warehouse choice is saved as the book's preferred warehouse.
        body: JSON.stringify({ name: meta.name, description: meta.description ?? null, source, sheets, warehouse: warehouse || null }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      const saved: BookMeta = { id: j.id, name: j.name, description: j.description, updatedAt: j.updatedAt, updatedBy: j.updatedBy }
      setBook(saved)
      setSavedSnapshot(snapshot(saved.name, source, sheets))
      setUrlBook(saved.id)
      qc.invalidateQueries({ queryKey: ["snowbooks"] })
      setNotice(t("n.saved", { name: saved.name }))
    } catch (e) {
      setNotice(t("n.saveFailed", { err: e instanceof Error ? e.message : String(e) }))
    } finally {
      setSaving(false)
    }
  }

  const openBook = async (id: string, skipConfirm = false) => {
    if (!skipConfirm && dirty && !window.confirm(t("n.discard", { name: book!.name }))) return
    try {
      const r = await fetch(`/api/snowbooks/${id}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
      const ss: SheetState[] = (j.sheets as Partial<SheetState>[]).map((s, i) => ({
        ...newSheet(i + 1),
        ...s,
        spec: { ...EMPTY_SPEC, ...(s.spec ?? {}) },
      })) as SheetState[]
      const meta: BookMeta = { id: j.id, name: j.name, description: j.description, updatedAt: j.updatedAt, updatedBy: j.updatedBy }
      setSource(j.source)
      if (j.warehouse) setWarehouse(j.warehouse) // dropped by WarehouseSelect if not available to this user
      setDatabase(j.source.database)
      setSchema(j.source.schema)
      setSheets(ss)
      setActiveId(ss[0].id)
      setBook(meta)
      setSavedSnapshot(snapshot(meta.name, j.source, ss))
      setRunSpec(null)
      setSort({ by: "label", dir: "asc" })
      setUrlBook(meta.id)
    } catch (e) {
      setNotice(t("n.openFailed", { err: e instanceof Error ? e.message : String(e) }))
      setUrlBook(null)
    }
  }

  const newBook = () => {
    const hasWork = !!source && (source.kind === "MODEL" || sheets.some((sh) => specIsRunnable(sh.spec)))
    if ((dirty || (!book && hasWork)) && !window.confirm(t("n.startOver"))) return
    const sh = newSheet(1)
    setSheets([sh])
    setActiveId(sh.id)
    setSource(null)
    setBook(null)
    setSavedSnapshot(null)
    setRunSpec(null)
    setUrlBook(null)
  }

  const deleteCurrentBook = async () => {
    if (!book || !window.confirm(t("n.confirmDelete", { name: book.name }))) return
    const r = await fetch(`/api/snowbooks/${book.id}`, { method: "DELETE" })
    if (!r.ok) return setNotice(t("n.deleteFailed"))
    setNotice(t("n.deleted", { name: book.name }))
    setBook(null)
    setSavedSnapshot(null)
    setUrlBook(null)
    qc.invalidateQueries({ queryKey: ["snowbooks"] })
  }

  // Open ?book=<id> on load (shareable links).
  useEffect(() => {
    if (!hydrated) return
    const id = new URL(window.location.href).searchParams.get("book")
    if (id && id !== book?.id) void openBook(id, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated])

  // Ctrl/Cmd+S saves.
  const saveRef = useRef(saveBook)
  saveRef.current = saveBook
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // ---- sheets ----------------------------------------------------------------
  const nextSheetName = () => {
    let n = sheets.length + 1
    while (sheets.some((s) => s.name === t("sheet.name", { n }))) n++
    return n
  }
  const addSheet = () => {
    const sh = newSheet(nextSheetName(), { ...EMPTY_SPEC, totals: spec.totals, limit: spec.limit })
    setSheets((ss) => [...ss, sh])
    selectSheet(sh.id)
  }
  const duplicateSheet = (id: string) => {
    const src = sheets.find((s) => s.id === id)
    if (!src) return
    const sh = { ...src, id: uid(), name: t("n.copySuffix", { name: src.name }) }
    setSheets((ss) => {
      const i = ss.findIndex((s) => s.id === id)
      return [...ss.slice(0, i + 1), sh, ...ss.slice(i + 1)]
    })
    selectSheet(sh.id)
  }
  const renameSheet = (id: string, name: string) => setSheets((ss) => ss.map((s) => (s.id === id ? { ...s, name } : s)))
  const deleteSheet = (id: string) => {
    if (sheets.length === 1) return
    const sh = sheets.find((s) => s.id === id)
    if (sh && specIsRunnable(sh.spec) && !window.confirm(t("n.confirmDeleteSheet", { name: sh.name }))) return
    const rest = sheets.filter((s) => s.id !== id)
    setSheets(rest)
    if (id === activeId) selectSheet(rest[0].id)
  }

  // ---- shelf editing ---------------------------------------------------------
  const validateTarget = useCallback(
    (f: Field, shelf: ShelfId): string | null => {
      const isMeasureOnly = f.role === "metric" || f.id === COUNT_ROWS_ID || !!f.calc
      if ((shelf === "rows" || shelf === "columns") && isMeasureOnly) return t("n.onlyValues", { name: fieldLabel(f, f.id) })
      if (shelf === "filters" && isMeasureOnly) return t("n.notFilter", { name: fieldLabel(f, f.id) })
      if (shelf === "values" && isSV && f.role !== "metric" && !f.calc) return t("n.svValues")
      return null
    },
    [isSV],
  )

  const onDrop = useCallback(
    (shelf: ShelfId, index: number, p: DragPayload) => {
      const f = fieldMap.get(p.fieldId)
      if (!f) return
      const err = validateTarget(f, shelf)
      if (err) return setNotice(err)

      setSpec((s) => {
        const next: PivotSpec = {
          ...s,
          rows: [...s.rows],
          columns: [...s.columns],
          values: [...s.values],
          filters: [...s.filters],
        }
        let carried: unknown = null
        let idx = index
        if (p.from) {
          carried = (next[p.from.shelf] as unknown[]).splice(p.from.index, 1)[0]
          if (p.from.shelf === shelf && p.from.index < idx) idx--
        }

        if (shelf === "rows" || shelf === "columns") {
          const fromDim = p.from && (p.from.shelf === "rows" || p.from.shelf === "columns")
          const item = fromDim ? (carried as PivotSpec["rows"][number]) : { fieldId: f.id }
          // A field can appear once across rows+columns (same grain).
          const dup = (arr: PivotSpec["rows"]) =>
            arr.findIndex((d) => d.fieldId === item.fieldId && (d.grain ?? null) === (item.grain ?? null))
          for (const axis of ["rows", "columns"] as const) {
            const i = dup(next[axis])
            if (i >= 0) {
              next[axis].splice(i, 1)
              if (axis === shelf && i < idx) idx--
            }
          }
          next[shelf].splice(idx, 0, item)
        } else if (shelf === "values") {
          const item = p.from?.shelf === "values" ? (carried as PivotSpec["values"][number]) : { fieldId: f.id, agg: defaultAgg(f, isSV) }
          next.values.splice(idx, 0, item)
        } else {
          const item: FilterRef = p.from?.shelf === "filters" ? (carried as FilterRef) : { fieldId: f.id, op: "in", values: [] }
          next.filters.splice(idx, 0, item)
        }
        return next
      })
    },
    [fieldMap, validateTarget, isSV, setSpec],
  )

  const quickAdd = (f: Field) => {
    if (f.role === "dimension") {
      const target: ShelfId = spec.rows.some((d) => d.fieldId === f.id) ? "columns" : "rows"
      onDrop(target, spec[target].length, { fieldId: f.id })
    } else onDrop("values", spec.values.length, { fieldId: f.id })
  }

  const removeAt = (shelf: ShelfId, i: number) =>
    setSpec((s) => ({ ...s, [shelf]: (s[shelf] as unknown[]).filter((_, j) => j !== i) }))

  const patch = <K extends ShelfId>(shelf: K, i: number, value: PivotSpec[K][number]) =>
    setSpec((s) => ({ ...s, [shelf]: (s[shelf] as unknown[]).map((x, j) => (j === i ? value : x)) }))

  const swapAxes = () => setSpec((s) => ({ ...s, rows: s.columns, columns: s.rows }))

  // ---- pills -----------------------------------------------------------------
  const dimPills = (axis: "rows" | "columns"): PillItem[] =>
    spec[axis].map((d, i) => {
      const f = fieldMap.get(d.fieldId)
      const canGrain = !isSV && f?.family === "date"
      const other = axis === "rows" ? "columns" : "rows"
      return {
        key: `${d.fieldId}|${d.grain ?? ""}|${i}`,
        label: dimHeader(spec, fieldMap, axis, i),
        field: f,
        tone: "dim",
        menu: (close) => (
          <>
            {canGrain && (
              <>
                <MenuLabel>{t("pill.grain")}</MenuLabel>
                <MenuItem active={!d.grain} onClick={() => (patch(axis, i, { fieldId: d.fieldId }), close())}>
                  {t("pill.exact")}
                </MenuItem>
                {GRAINS.map((g) => (
                  <MenuItem key={g} active={d.grain === g} onClick={() => (patch(axis, i, { fieldId: d.fieldId, grain: g }), close())}>
                    {grainLabel(g)}
                  </MenuItem>
                ))}
                <div className="my-1 border-t border-border" />
              </>
            )}
            <MenuItem
              onClick={() => {
                onDrop(other, spec[other].length, { fieldId: d.fieldId, from: { shelf: axis, index: i } })
                close()
              }}
            >
              {t("pill.moveTo", { shelf: t(other === "rows" ? "shelf.rows" : "shelf.columns") })}
            </MenuItem>
            <MenuItem
              onClick={() => {
                setSpec((s) => ({ ...s, filters: [...s.filters, { fieldId: d.fieldId, op: "in", values: [] }] }))
                close()
              }}
            >
              {t("pill.addFilter")}
            </MenuItem>
          </>
        ),
      }
    })

  const valuePills: PillItem[] = spec.values.map((v, i) => {
    const f = fieldMap.get(v.fieldId)
    const aggs = f && !isSV ? aggsFor(f) : []
    return {
      key: `${v.fieldId}|${v.agg}|${i}`,
      label: valueLabel(v, f),
      field: f,
      tone: "measure",
      menu: aggs.length
        ? (close) => (
            <>
              <MenuLabel>{t("pill.aggregation")}</MenuLabel>
              {aggs.map((a) => (
                <MenuItem key={a} active={v.agg === a} onClick={() => (patch("values", i, { fieldId: v.fieldId, agg: a }), close())}>
                  {aggLabel(a)}
                </MenuItem>
              ))}
            </>
          )
        : undefined,
    }
  })

  const filterPills: PillItem[] = spec.filters.map((flt, i) => {
    const f = fieldMap.get(flt.fieldId)
    return {
      key: `${flt.fieldId}|${i}`,
      label: describeFilter(flt, f),
      field: f,
      tone: "filter",
      menu:
        f && source
          ? (close) => <FilterEditor source={source} field={f} filter={flt} onApply={(nf) => patch("filters", i, nf)} onClose={close} />
          : undefined,
    }
  })

  // ---- export ----------------------------------------------------------------
  const exportCsv = () => {
    if (!grid || !result.data) return
    const m = pivotMatrix(grid, result.data.spec, fieldMap, sort)
    const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    const csv = "\uFEFF" + m.map((r) => r.map(esc).join(";")).join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }))
    a.download = `${source?.name ?? "snowdash"}_pivot.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const err = (result.error ?? null) as (Error & { sql?: string }) | null
  const shownSql = result.data?.sql ?? err?.sql ?? ""
  const toggleCls = (on: boolean) =>
    `inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs ${
      on ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground hover:bg-accent"
    }`

  return (
    <div className="flex h-[calc(100vh-3.5rem)] w-full overflow-hidden">
      <CatalogPanel
        database={database}
        schema={schema}
        source={source}
        onDatabase={chooseDatabase}
        onSchema={setSchema}
        onSource={chooseSource}
        fields={fieldsQ.data}
        fieldsLoading={fieldsQ.isLoading}
        fieldsError={fieldsQ.error ? fieldsQ.error.message : null}
        onQuickAdd={quickAdd}
        onAddToModel={addToModel}
        calcFields={calcFields}
        onNewCalc={() => setCalcEdit("new")}
        onEditCalc={(f) => f.calc && setCalcEdit(f.calc)}
        folders={source?.folders ?? []}
        onFolders={(folders) => setSource((s) => (s ? { ...s, folders } : s))}
      />
      {calcEdit && source && (
        <CalcEditor
          source={source}
          fields={fieldsQ.data ?? []}
          initial={calcEdit === "new" ? null : calcEdit}
          takenNames={(source.calcs ?? []).filter((c) => calcEdit === "new" || c.id !== calcEdit.id).map((c) => c.name)}
          onSave={saveCalc}
          onDelete={calcEdit === "new" ? undefined : () => deleteCalc(calcEdit.id)}
          onClose={() => setCalcEdit(null)}
        />
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <BookBar
          book={book}
          dirty={dirty}
          saving={saving}
          canSave={!!source}
          onRename={(name) => setBook((b) => (b ? { ...b, name } : b))}
          onSave={() => void saveBook()}
          onSaveAs={() => void saveBook(true)}
          onOpen={(id) => void openBook(id)}
          onNew={newBook}
          onDelete={() => void deleteCurrentBook()}
        />
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <div className="mr-2 flex min-w-0 items-center gap-1.5 text-sm">
            {isSV ? (
              <Sparkles className="size-4 text-violet-600" />
            ) : source?.kind === "MODEL" ? (
              <Link2 className="size-4 text-violet-600" />
            ) : (
              <Table2 className="size-4 text-sky-600" />
            )}
            <span className="truncate font-semibold">
              {source
                ? source.kind === "MODEL"
                  ? t("tb.model", { tables: source.model!.tables.map((x) => x.alias).join(" ⋈ ") })
                  : `${source.database}.${source.schema}.${source.name}`
                : t("tb.noSource")}
            </span>
            {adding && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <button className={toggleCls(auto)} onClick={() => setAuto((a) => !a)} title={t("tb.autoTitle")}>
              <Zap className="size-3.5" /> Auto
            </button>
            <Button size="sm" onClick={runNow} disabled={!source || result.isFetching}>
              {result.isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {t("tb.run")}
            </Button>
            <span className="mx-1 h-5 w-px bg-border" />
            <button className={toggleCls(spec.totals)} onClick={() => setSpec((s) => ({ ...s, totals: !s.totals }))}>
              <Sigma className="size-3.5" /> {t("tb.totals")}
            </button>
            <button className={toggleCls(heatmap)} onClick={() => setHeatmap((h) => !h)} disabled={view !== "table"}>
              <Flame className="size-3.5" /> {t("tb.heat")}
            </button>
            <button className={toggleCls(false)} onClick={swapAxes} title={t("tb.swap")}>
              <ArrowLeftRight className="size-3.5" />
            </button>
            <select
              className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
              value={spec.limit}
              onChange={(e) => setSpec((s) => ({ ...s, limit: Number(e.target.value) }))}
              title={t("tb.limitTitle")}
            >
              {[1000, 10000, 50000].map((n) => (
                <option key={n} value={n}>
                  {t("tb.upTo", { n: n.toLocaleString(currentLocale()) })}
                </option>
              ))}
            </select>
            <span className="mx-1 h-5 w-px bg-border" />
            <button className={toggleCls(view === "table")} onClick={() => setView("table")}>
              <Table2 className="size-3.5" /> {t("tb.table")}
            </button>
            <button className={toggleCls(view === "chart")} onClick={() => setView("chart")}>
              <BarChart3 className="size-3.5" /> {t("tb.chart")}
            </button>
            {view === "chart" && (
              <select
                className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
                value={chartKind}
                onChange={(e) => setChartKind(e.target.value as ChartKind)}
              >
                <option value="bar">{t("tb.bar")}</option>
                <option value="stacked">{t("tb.stacked")}</option>
                <option value="line">{t("tb.line")}</option>
                <option value="area">{t("tb.area")}</option>
              </select>
            )}
            <span className="mx-1 h-5 w-px bg-border" />
            {source?.kind === "MODEL" && (
              <button
                className={toggleCls(showModel || !modelReady)}
                onClick={() => setShowModel((s) => !s)}
                title={`${t("model.title")} (${t("book.tables", { n: source.model!.tables.length })})`}
              >
                <Link2 className="size-3.5" /> {t("model.title")}
                {!modelReady && <span className="size-1.5 rounded-full bg-destructive" />}
              </button>
            )}
            <button className={toggleCls(showSql)} onClick={() => setShowSql((s) => !s)}>
              <Code2 className="size-3.5" /> SQL
            </button>
            <button className={toggleCls(false)} onClick={exportCsv} disabled={!grid}>
              <Download className="size-3.5" /> CSV
            </button>
            <button
              className={toggleCls(false)}
              onClick={() => {
                setSpec((s) => ({ ...EMPTY_SPEC, totals: s.totals, limit: s.limit }))
                setRunSpec(null)
              }}
              title={t("tb.clear")}
            >
              <Eraser className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Data model — always shown while a join still lacks keys */}
        {source?.kind === "MODEL" && source.model && (showModel || !modelReady) && (
          <ModelBar model={source.model} fields={fieldsQ.data} onChange={changeModel} onRemove={removeFromModel} />
        )}

        {/* Shelves */}
        <div className="space-y-1.5 border-b border-border bg-muted/40 px-3 py-2">
          <Shelf id="filters" title={t("shelf.filters")} icon={<Filter className="size-3" />} items={filterPills} placeholder={t("shelf.filtersPh")} onDrop={onDrop} onRemove={(i) => removeAt("filters", i)} />
          <Shelf id="columns" title={t("shelf.columns")} icon={<Columns3 className="size-3" />} items={dimPills("columns")} placeholder={t("shelf.columnsPh")} onDrop={onDrop} onRemove={(i) => removeAt("columns", i)} />
          <Shelf id="rows" title={t("shelf.rows")} icon={<Rows3 className="size-3" />} items={dimPills("rows")} placeholder={t("shelf.rowsPh")} onDrop={onDrop} onRemove={(i) => removeAt("rows", i)} />
          <Shelf id="values" title={t("shelf.values")} icon={<Sigma className="size-3" />} items={valuePills} placeholder={isSV ? t("shelf.valuesPhSV") : t("shelf.valuesPh")} onDrop={onDrop} onRemove={(i) => removeAt("values", i)} />
        </div>

        {notice && <div className="border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200">{notice}</div>}

        {showSql && shownSql && (
          <pre className="max-h-52 overflow-auto border-b border-border bg-muted/60 px-3 py-2 font-mono text-[11px] leading-relaxed">
            {result.data?.warehouse ? `-- ${t("status.warehouse", { name: result.data.warehouse })}\n` : ""}
            {shownSql}
          </pre>
        )}

        {/* Result */}
        <div className="relative min-h-0 flex-1">
          {!source ? (
            <EmptyState />
          ) : err ? (
            <div className="p-4 text-sm text-destructive">
              <p className="font-semibold">{t("res.error")}</p>
              <p className="mt-1 whitespace-pre-wrap font-mono text-xs">{err.message}</p>
            </div>
          ) : !grid ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {result.isFetching ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> {t("res.querying")}
                </span>
              ) : (
                t("res.dragHint")
              )}
            </div>
          ) : view === "table" ? (
            <PivotTable key={result.dataUpdatedAt} grid={grid} spec={result.data!.spec} fields={fieldMap} heatmap={heatmap} heatColor={sheetTheme.heat} sort={sort} onSort={setSort} />
          ) : (
            <PivotChart grid={grid} spec={result.data!.spec} fields={fieldMap} kind={chartKind} sort={sort} palette={sheetTheme.palette} />
          )}
          {grid && result.isFetching && (
            <div className="absolute right-3 top-3 flex items-center gap-2 rounded-md border border-border bg-popover px-2 py-1 text-xs shadow">
              <Loader2 className="size-3.5 animate-spin" /> {t("res.updating")}
            </div>
          )}
        </div>

        <SheetTabs
          sheets={sheets}
          activeId={active.id}
          onSelect={selectSheet}
          onAdd={addSheet}
          onRename={renameSheet}
          onDuplicate={duplicateSheet}
          onDelete={deleteSheet}
          onTheme={(id, th) => setSheets((ss) => ss.map((s) => (s.id === id ? { ...s, theme: th } : s)))}
        />

        {/* Status bar */}
        <div className="flex items-center gap-3 border-t border-border px-3 py-1 text-[11px] text-muted-foreground">
          {result.data && (
            <>
              <span>
                {t("status.grid", { r: (grid?.rowKeys.length ?? 0).toLocaleString(currentLocale()), c: Math.max(grid?.colKeys.length ?? 0, 1).toLocaleString(currentLocale()) })}
              </span>
              <span>{t("status.records", { n: result.data.rows.length.toLocaleString(currentLocale()) })}</span>
              <span>{(result.data.elapsedMs / 1000).toFixed(2)} s</span>
              {result.data.warehouse && <span>{t("status.warehouse", { name: result.data.warehouse })}</span>}
              {result.data.truncated && (
                <span className="font-medium text-amber-600">{t("status.truncated")}</span>
              )}
            </>
          )}
          {stale && <span className="font-medium text-primary">{t("status.pending")}</span>}
          {source && fieldsQ.data && (
            <span className="ml-auto">
              {t("status.fields", {
                d: fieldsQ.data.filter((f) => f.role === "dimension").length,
                m: fieldsQ.data.filter((f) => f.role !== "dimension").length,
                kind: t(isSV ? "status.metrics" : "status.measures"),
              })}
            </span>
          )}
        </div>
      </main>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <div className="flex gap-2">
        <Rows3 className="size-6" />
        <Columns3 className="size-6" />
        <LineIcon className="size-6" />
      </div>
      <p className="text-sm font-medium text-foreground">{t("res.emptyTitle")}</p>
      <p className="max-w-md text-xs">
        {t("res.emptyBody")}
      </p>
    </div>
  )
}

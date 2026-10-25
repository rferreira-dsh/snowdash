"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown, X } from "lucide-react"
import type { Field } from "@/lib/pivot/types"
import { t } from "@/lib/i18n/client"
import { FamilyIcon } from "./catalog-panel"
import { DRAG_MIME, readPayload, type DragPayload, type ShelfId } from "./dnd"

export interface PillItem {
  key: string
  label: string
  field?: Field
  /** Rendered inside the pill dropdown; receives a close callback. */
  menu?: (close: () => void) => React.ReactNode
  tone?: "dim" | "measure" | "filter"
}

interface ShelfProps {
  id: ShelfId
  title: string
  icon: React.ReactNode
  items: PillItem[]
  placeholder: string
  onDrop: (shelf: ShelfId, index: number, payload: DragPayload) => void
  onRemove: (index: number) => void
  vertical?: boolean
}

export function Shelf({ id, title, icon, items, placeholder, onDrop, onRemove, vertical }: ShelfProps) {
  const [over, setOver] = useState<number | null>(null)

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    setOver(null)
    const p = readPayload(e)
    if (p) onDrop(id, index, p)
  }

  return (
    <div
      className={`flex min-h-10 gap-2 rounded-lg border border-dashed px-2 py-1.5 transition-colors ${
        over !== null ? "border-primary bg-primary/5" : "border-border bg-card"
      } ${vertical ? "flex-col" : "items-center"}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return
        e.preventDefault()
        if (over === null) setOver(items.length)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null)
      }}
      onDrop={(e) => handleDrop(e, over ?? items.length)}
    >
      <div className="flex w-20 shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      <div className={`flex min-w-0 flex-1 flex-wrap gap-1.5 ${vertical ? "flex-col" : "items-center"}`}>
        {items.length === 0 && <span className="text-xs italic text-muted-foreground/70">{placeholder}</span>}
        {items.map((it, i) => (
          <Pill
            key={it.key}
            item={it}
            dragPayload={{ fieldId: it.field?.id ?? it.key, from: { shelf: id, index: i } }}
            highlight={over === i}
            onDragOverPill={() => setOver(i)}
            onDropPill={(e) => handleDrop(e, i)}
            onRemove={() => onRemove(i)}
          />
        ))}
      </div>
    </div>
  )
}

function Pill({
  item,
  dragPayload,
  highlight,
  onDragOverPill,
  onDropPill,
  onRemove,
}: {
  item: PillItem
  dragPayload: DragPayload
  highlight: boolean
  onDragOverPill: () => void
  onDropPill: (e: React.DragEvent) => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const tone =
    item.tone === "measure"
      ? "bg-emerald-500/12 border-emerald-500/40 text-emerald-900 dark:text-emerald-100"
      : item.tone === "filter"
        ? "bg-amber-500/12 border-amber-500/40 text-amber-900 dark:text-amber-100"
        : "bg-sky-500/12 border-sky-500/40 text-sky-900 dark:text-sky-100"

  return (
    <div ref={ref} className="relative">
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, JSON.stringify(dragPayload))
          e.dataTransfer.effectAllowed = "move"
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_MIME)) return
          e.preventDefault()
          e.stopPropagation()
          onDragOverPill()
        }}
        onDrop={onDropPill}
        className={`flex h-7 cursor-grab items-center gap-1.5 rounded-full border pl-2.5 pr-1 text-xs active:cursor-grabbing ${tone} ${
          highlight ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""
        }`}
      >
        {item.field && <FamilyIcon field={item.field} />}
        <button
          type="button"
          className="flex max-w-56 items-center gap-1 truncate"
          onClick={() => item.menu && setOpen((o) => !o)}
          title={item.label}
        >
          <span className="truncate">{item.label}</span>
          {item.menu && <ChevronDown className="size-3 shrink-0 opacity-60" />}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full p-0.5 opacity-60 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
          aria-label={t("shelf.remove")}
        >
          <X className="size-3" />
        </button>
      </div>
      {open && item.menu && (
        <div className="absolute left-0 top-8 z-40 min-w-48 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          {item.menu(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  active,
  onClick,
  children,
}: {
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-accent ${
        active ? "font-semibold text-primary" : ""
      }`}
    >
      {children}
    </button>
  )
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</div>
}

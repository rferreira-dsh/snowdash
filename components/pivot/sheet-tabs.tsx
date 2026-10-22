"use client"

import { useState } from "react"
import { Copy, Plus, X } from "lucide-react"
import { t } from "@/lib/i18n/client"

interface Props {
  sheets: { id: string; name: string }[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}

/** Tableau-style sheet tabs; double-click to rename. */
export function SheetTabs(p: Props) {
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-t border-border bg-muted/40 px-2">
      {p.sheets.map((s) => {
        const active = s.id === p.activeId
        return (
          <div
            key={s.id}
            className={`group flex h-8 shrink-0 items-center gap-1 border-x border-b-2 px-2 text-xs ${
              active ? "border-x-border border-b-primary bg-background font-medium" : "border-transparent text-muted-foreground hover:bg-accent"
            }`}
          >
            {editing === s.id ? (
              <input
                autoFocus
                defaultValue={s.name}
                className="h-6 w-32 rounded border border-input bg-background px-1 text-xs"
                onBlur={(e) => {
                  p.onRename(s.id, e.target.value.trim() || s.name)
                  setEditing(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                  if (e.key === "Escape") setEditing(null)
                }}
              />
            ) : (
              <button onClick={() => p.onSelect(s.id)} onDoubleClick={() => setEditing(s.id)} title={t("sheet.renameHint")}>
                {s.name}
              </button>
            )}
            {active && editing !== s.id && (
              <>
                <button className="rounded p-0.5 opacity-50 hover:bg-accent hover:opacity-100" onClick={() => p.onDuplicate(s.id)} title={t("sheet.duplicate")}>
                  <Copy className="size-3" />
                </button>
                {p.sheets.length > 1 && (
                  <button className="rounded p-0.5 opacity-50 hover:bg-accent hover:opacity-100" onClick={() => p.onDelete(s.id)} title={t("sheet.delete")}>
                    <X className="size-3" />
                  </button>
                )}
              </>
            )}
          </div>
        )
      })}
      <button className="ml-1 flex h-7 shrink-0 items-center gap-1 rounded px-2 text-xs text-muted-foreground hover:bg-accent" onClick={p.onAdd} title={t("sheet.addTitle")}>
        <Plus className="size-3.5" /> {t("sheet.add")}
      </button>
    </div>
  )
}

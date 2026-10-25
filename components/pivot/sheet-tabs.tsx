"use client"

import { useEffect, useRef, useState } from "react"
import { Copy, Palette, Plus, X } from "lucide-react"
import { t } from "@/lib/i18n/client"
import { THEME_IDS, THEMES, theme } from "./themes"

interface Props {
  sheets: { id: string; name: string; theme?: string }[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onRename: (id: string, name: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
  onTheme: (id: string, theme: string) => void
}

/** Tableau-style sheet tabs; double-click to rename. */
export function SheetTabs(p: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [picker, setPicker] = useState<string | null>(null)
  const [pos, setPos] = useState({ left: 0, bottom: 0 })
  const pickerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!picker) return
    const close = (e: MouseEvent) => !pickerRef.current?.contains(e.target as Node) && setPicker(null)
    window.addEventListener("mousedown", close)
    return () => window.removeEventListener("mousedown", close)
  }, [picker])

  return (
    <div className="flex items-center gap-0.5 overflow-x-auto border-t border-border bg-muted/40 px-2">
      {p.sheets.map((s) => {
        const active = s.id === p.activeId
        const color = theme(s.theme).main
        return (
          <div
            key={s.id}
            className={`group relative flex h-8 shrink-0 items-center gap-1.5 border-x border-b-[3px] px-2 text-xs ${
              active ? "border-x-border bg-background font-medium" : "border-x-transparent text-muted-foreground hover:bg-accent"
            }`}
            style={{ borderBottomColor: active ? color : `${color}66` }}
          >
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
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
                <button
                  className="rounded p-0.5 opacity-50 hover:bg-accent hover:opacity-100"
                  onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setPos({ left: r.left, bottom: window.innerHeight - r.top + 4 })
                    setPicker(picker === s.id ? null : s.id)
                  }}
                  title={t("sheet.color")}
                >
                  <Palette className="size-3" />
                </button>
                {picker === s.id && (
                  <div
                    ref={pickerRef}
                    style={pos}
                    className="fixed z-50 flex gap-1 rounded-md border border-border bg-popover p-1.5 shadow-lg"
                  >
                    {THEME_IDS.map((id) => (
                      <button
                        key={id}
                        title={t(`theme.${id}`)}
                        onClick={() => (p.onTheme(s.id, id), setPicker(null))}
                        className={`flex size-6 items-center justify-center rounded ${theme(s.theme) === THEMES[id] ? "ring-2 ring-ring" : ""}`}
                      >
                        <span className="flex h-4 w-4 overflow-hidden rounded-sm">
                          {THEMES[id].palette.slice(0, 3).map((c) => (
                            <span key={c} className="flex-1" style={{ backgroundColor: c }} />
                          ))}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
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

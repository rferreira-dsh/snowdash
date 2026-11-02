"use client"

import { useState } from "react"
import { Power } from "lucide-react"
import { t } from "@/lib/i18n/client"

/**
 * "Encerrar" button: cancels the user's running/queued queries on the server, then tries to
 * close the tab. Browsers only let scripts close tabs they opened, so when that is refused the
 * page is replaced by a "session closed" screen instead.
 */
export function CloseAppButton() {
  const [closed, setClosed] = useState<{ cancelled: number | null } | null>(null)

  const close = async () => {
    if (!window.confirm(t("close.confirm"))) return
    let cancelled: number | null = null
    try {
      const res = await fetch("/api/close", { method: "POST", keepalive: true })
      if (res.ok) cancelled = Number((await res.json()).cancelled ?? 0)
    } catch {
      // Still close the page; the server-side queue/wait limits remain as a fallback.
    }
    setClosed({ cancelled })
    window.close()
  }

  if (closed) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-background text-foreground">
        <Power className="size-8 text-muted-foreground" />
        <p className="text-sm font-semibold">{t("close.done")}</p>
        <p className="text-xs text-muted-foreground">
          {closed.cancelled == null ? t("close.cancelFailed") : t("close.cancelled", { n: closed.cancelled })}
        </p>
        <p className="text-xs text-muted-foreground">{t("close.closeTab")}</p>
        <button
          type="button"
          className="mt-2 rounded-md border border-border px-3 py-1 text-xs hover:bg-accent"
          onClick={() => window.location.reload()}
        >
          {t("close.reopen")}
        </button>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={close}
      title={t("close.title")}
      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:border-destructive hover:text-destructive"
    >
      <Power className="size-3.5" /> {t("close.label")}
    </button>
  )
}

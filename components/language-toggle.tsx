"use client"

import { Languages } from "lucide-react"
import { useLang, t } from "@/lib/i18n/client"
import type { Lang } from "@/lib/i18n/messages"

const OPTIONS: { value: Lang; label: string; flag: string }[] = [
  { value: "pt", label: "Português", flag: "PT" },
  { value: "en", label: "English", flag: "EN" },
]

/** PT / EN segmented toggle for the header. */
export function LanguageToggle() {
  const { lang, setLang } = useLang()
  return (
    <div className="flex items-center gap-1.5" title={t("lang.label")}>
      <Languages className="size-4 text-muted-foreground" />
      <div role="radiogroup" aria-label={t("lang.label")} className="flex rounded-md border border-border p-0.5">
        {OPTIONS.map((o) => (
          <button
            key={o.value}
            role="radio"
            aria-checked={lang === o.value}
            title={o.label}
            onClick={() => setLang(o.value)}
            className={`rounded px-2 py-0.5 text-xs font-medium ${
              lang === o.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent"
            }`}
          >
            {o.flag}
          </button>
        ))}
      </div>
    </div>
  )
}

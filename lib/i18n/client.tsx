"use client"

/**
 * Client-side i18n.
 *  - `t(key, vars)` reads the current language from a module-level variable, so it can be
 *    used inside plain helpers (labels, formatters) as well as components.
 *  - <I18nProvider> owns the language state, persists it, and re-renders the tree on change.
 *  - Same-origin `/api/*` fetches get the `x-snowdash-lang` header so server errors come back localized,
 *    plus the chosen warehouse (lib/warehouse-client.ts), if any.
 */

import { createContext, useCallback, useContext, useEffect, useState } from "react"
import { isLang, LANG_HEADER, locale, translate, type Lang, type Vars } from "./messages"
import { getWarehouse, WAREHOUSE_HEADER } from "@/lib/warehouse-client"

const STORAGE_KEY = "snowdash:lang"
let currentLang: Lang = "pt"

export function t(key: string, vars?: Vars): string {
  return translate(currentLang, key, vars)
}

export function getLang(): Lang {
  return currentLang
}

/** Number/date locale for the current language (pt-BR / en-US). */
export function currentLocale(): string {
  return locale(currentLang)
}

let fetchPatched = false
function patchFetch() {
  if (fetchPatched || typeof window === "undefined") return
  fetchPatched = true
  const orig = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url
    if (url.startsWith("/api/")) {
      const headers = new Headers(init?.headers)
      headers.set(LANG_HEADER, currentLang)
      const wh = getWarehouse()
      if (wh && !headers.has(WAREHOUSE_HEADER)) headers.set(WAREHOUSE_HEADER, wh)
      return orig(input, { ...init, headers })
    }
    return orig(input, init)
  }
}

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "pt", setLang: () => {} })

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(currentLang)

  useEffect(() => {
    patchFetch()
    const saved = localStorage.getItem(STORAGE_KEY)
    const initial: Lang = isLang(saved) ? saved : /^en/i.test(navigator.language) ? "en" : "pt"
    currentLang = initial
    setLangState(initial)
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang === "en" ? "en" : "pt-BR"
  }, [lang])

  const setLang = useCallback((l: Lang) => {
    currentLang = l
    localStorage.setItem(STORAGE_KEY, l)
    setLangState(l)
  }, [])

  // Components that call useLang() re-render on change (Workbench does, so its whole subtree follows).
  return <Ctx.Provider value={{ lang, setLang }}>{children}</Ctx.Provider>
}

export function useLang() {
  return useContext(Ctx)
}

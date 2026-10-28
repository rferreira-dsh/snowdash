"use client"

/**
 * Client-side warehouse choice.
 *  - Persisted in localStorage; "" means the service's default warehouse.
 *  - Sent on every same-origin `/api/*` fetch as WAREHOUSE_HEADER (see lib/i18n/client.tsx);
 *    the server validates it against the user's warehouses.
 */

import { useSyncExternalStore } from "react"

export const WAREHOUSE_HEADER = "x-snowdash-warehouse"
const STORAGE_KEY = "snowdash:warehouse"

let current = ""
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === "undefined") return
  loaded = true
  current = localStorage.getItem(STORAGE_KEY) ?? ""
}

export function getWarehouse(): string {
  load()
  return current
}

export function setWarehouse(name: string | null | undefined) {
  load()
  const next = (name ?? "").trim()
  if (next === current) return
  current = next
  if (next) localStorage.setItem(STORAGE_KEY, next)
  else localStorage.removeItem(STORAGE_KEY)
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useWarehouse(): string {
  return useSyncExternalStore(subscribe, getWarehouse, () => "")
}

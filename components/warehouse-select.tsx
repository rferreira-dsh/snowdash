"use client"

import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { Server } from "lucide-react"
import { t, useLang } from "@/lib/i18n/client"
import { setWarehouse, useWarehouse } from "@/lib/warehouse-client"

interface WarehouseInfo {
  name: string
  size: string | null
  state: string | null
}

interface WarehousesResponse {
  default: string | null
  warehouses: WarehouseInfo[]
}

async function fetchWarehouses(): Promise<WarehousesResponse> {
  const r = await fetch("/api/warehouses")
  const j = await r.json()
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`)
  return j as WarehousesResponse
}

/** Header dropdown to pick the warehouse that runs data queries ("" = service default). */
export function WarehouseSelect() {
  useLang()
  const wh = useWarehouse()
  const { data, error } = useQuery({ queryKey: ["warehouses"], queryFn: fetchWarehouses, staleTime: 5 * 60 * 1000 })

  // Drop a stored choice the user can no longer use (renamed, revoked, removed from allow-list).
  useEffect(() => {
    if (data && wh && !data.warehouses.some((w) => w.name === wh)) setWarehouse("")
  }, [data, wh])

  // Pivot / filter-value queries key on the warehouse, so they re-run on change.
  const onChange = (name: string) => setWarehouse(name)

  return (
    <div className="flex items-center gap-1.5" title={error ? String((error as Error).message) : t("wh.label")}>
      <Server className="size-4 text-muted-foreground" />
      <select
        aria-label={t("wh.label")}
        value={wh}
        onChange={(e) => onChange(e.target.value)}
        disabled={!data}
        className="h-7 max-w-56 rounded-md border border-border bg-background px-1.5 text-xs disabled:opacity-60"
      >
        <option value="">{data?.default ? t("wh.defaultNamed", { name: data.default }) : t("wh.default")}</option>
        {data?.warehouses.map((w) => (
          <option key={w.name} value={w.name}>
            {w.name}
            {w.size ? ` · ${w.size}` : ""}
            {w.state === "SUSPENDED" ? ` · ${t("wh.suspended")}` : ""}
          </option>
        ))}
      </select>
    </div>
  )
}

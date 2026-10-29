/**
 * Data access as the CALLING user (caller's rights).
 *
 * Catalog browsing, field metadata, filter values and pivot queries all go through
 * these helpers, so each user only sees what their own role can see. SnowBook
 * storage deliberately does NOT use this (it is shared app state, owner's rights).
 *
 * In SPCS Snowflake injects the caller token; locally the SDK falls back to the
 * developer's connection with a warning.
 *
 * Escape hatch: when the service's database is listed in SNOWDASH_OWNER_RIGHTS_DBS
 * (comma-separated), these queries run with OWNER's rights instead. Use only where the
 * owner role lacks caller grants; every user then sees what the owner role sees.
 *
 * Warehouse: the client may pick one per request (WAREHOUSE_HEADER). It is accepted only
 * if it appears in the caller's SHOW WAREHOUSES (and in SNOWDASH_ALLOWED_WAREHOUSES when
 * set); otherwise the request fails. No header = the service's default warehouse.
 */

import { headers } from "next/headers"
import { querySnowflake, querySnowflakeLongRunning, type LongRunningQueryOptions } from "@/lib/snowflake"
import { AppError } from "@/lib/i18n/messages"

export const WAREHOUSE_HEADER = "x-snowdash-warehouse"

type Binds = NonNullable<LongRunningQueryOptions["binds"]>

const OWNER_RIGHTS_DBS = (process.env.SNOWDASH_OWNER_RIGHTS_DBS ?? "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)
const CALLERS_RIGHTS = !OWNER_RIGHTS_DBS.includes((process.env.SNOWFLAKE_DATABASE ?? "").toUpperCase())

const ALLOWED_WAREHOUSES = (process.env.SNOWDASH_ALLOWED_WAREHOUSES ?? "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)

export interface WarehouseInfo {
  name: string
  size: string | null
  state: string | null
  type: string | null
}

const WH_TTL_MS = 5 * 60 * 1000
const whCache = new Map<string, { at: number; list: Promise<WarehouseInfo[]> }>()

/** Warehouses the calling user (or owner, in owner-rights mode) can use, filtered by the allow-list. */
export async function listWarehouses(refresh = false): Promise<WarehouseInfo[]> {
  const k = await callerKey()
  const hit = whCache.get(k)
  if (!refresh && hit && Date.now() - hit.at < WH_TTL_MS) return hit.list
  if (whCache.size >= 500) whCache.delete(whCache.keys().next().value!)
  const list = querySnowflake("SHOW WAREHOUSES", { callersRights: CALLERS_RIGHTS }).then((rows) =>
    rows
      .map((r) => ({
        name: String(r.name),
        size: r.size == null ? null : String(r.size),
        state: r.state == null ? null : String(r.state),
        type: r.type == null ? null : String(r.type),
      }))
      .filter((w) => !ALLOWED_WAREHOUSES.length || ALLOWED_WAREHOUSES.includes(w.name.toUpperCase()))
      .sort((a, b) => a.name.localeCompare(b.name)),
  )
  whCache.set(k, { at: Date.now(), list })
  list.catch(() => whCache.delete(k))
  return list
}

let defaultWh: Promise<string | null> | null = null

/** The session's default warehouse (service query_warehouse / connection default). */
export function defaultWarehouse(): Promise<string | null> {
  if (!defaultWh) {
    defaultWh = querySnowflake("SELECT CURRENT_WAREHOUSE() AS WH").then((r) => (r[0]?.WH == null ? null : String(r[0].WH)))
    defaultWh.catch(() => (defaultWh = null))
  }
  return defaultWh
}

/** Warehouse requested for this request, validated; undefined = service default. */
export async function requestedWarehouse(): Promise<string | undefined> {
  let wanted: string | null = null
  try {
    wanted = (await headers()).get(WAREHOUSE_HEADER)
  } catch {
    return undefined
  }
  if (!wanted || !wanted.trim()) return undefined
  const name = wanted.trim()
  const match = (await listWarehouses()).find((w) => w.name === name)
  if (!match) throw new AppError("e.badWarehouse", { name: name.slice(0, 255) })
  return match.name
}

export async function userQuery(sql: string, binds?: Binds) {
  const warehouse = await requestedWarehouse()
  return querySnowflake(sql, { callersRights: CALLERS_RIGHTS, ...(warehouse ? { warehouse } : {}), ...(binds ? { binds } : {}) })
}

export async function userQueryLongRunning(sql: string, binds?: Binds, opts: Omit<LongRunningQueryOptions, "binds" | "callersRights"> = {}) {
  const warehouse = opts.warehouse ?? (await requestedWarehouse())
  return querySnowflakeLongRunning(sql, {
    ...opts,
    callersRights: CALLERS_RIGHTS,
    ...(warehouse ? { warehouse } : {}),
    ...(binds ? { binds } : {}),
  })
}

/** Calling user's login name (SPCS ingress header); "local" outside SPCS. Used to scope caches. */
export async function callerKey(): Promise<string> {
  try {
    return (await headers()).get("sf-context-current-user") ?? "local"
  } catch {
    return "local"
  }
}

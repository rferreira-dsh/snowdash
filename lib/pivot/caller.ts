/**
 * Data access as the CALLING user (caller's rights).
 *
 * Catalog browsing, field metadata, filter values and pivot queries all go through
 * these helpers, so each user only sees what their own role can see. SnowBook
 * storage deliberately does NOT use this (it is shared app state, owner's rights).
 *
 * In SPCS Snowflake injects the caller token; locally the SDK falls back to the
 * developer's connection with a warning.
 */

import { headers } from "next/headers"
import { querySnowflake, querySnowflakeLongRunning, type LongRunningQueryOptions } from "@/lib/snowflake"

type Binds = NonNullable<LongRunningQueryOptions["binds"]>

export function userQuery(sql: string, binds?: Binds) {
  return querySnowflake(sql, { callersRights: true, ...(binds ? { binds } : {}) })
}

export function userQueryLongRunning(sql: string, binds?: Binds, opts: Omit<LongRunningQueryOptions, "binds" | "callersRights"> = {}) {
  return querySnowflakeLongRunning(sql, { ...opts, callersRights: true, ...(binds ? { binds } : {}) })
}

/** Calling user's login name (SPCS ingress header); "local" outside SPCS. Used to scope caches. */
export async function callerKey(): Promise<string> {
  try {
    return (await headers()).get("sf-context-current-user") ?? "local"
  } catch {
    return "local"
  }
}

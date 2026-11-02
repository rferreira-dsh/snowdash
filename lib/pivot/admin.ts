/**
 * Admin-only maintenance: list / cancel the SERVICE user's own in-flight queries.
 *
 * In owner's-rights mode every SnowDash user runs as the service user (e.g. MANAGED_SERVICE_1),
 * and queries abandoned by older builds can stay queued/running on a warehouse. A user can always
 * see (INFORMATION_SCHEMA.QUERY_HISTORY) and cancel (SYSTEM$CANCEL_QUERY) their own queries, so
 * these run with OWNER's rights and only ever touch queries whose USER_NAME = CURRENT_USER().
 *
 * Access: only logins listed in SNOWDASH_ADMIN_USERS (comma-separated). When
 * SNOWDASH_SERVICE_USER is set, the service must be running as exactly that user.
 */

import { querySnowflake, querySnowflakeLongRunning } from "@/lib/snowflake"
import { AppError } from "@/lib/i18n/messages"
import { callerKey } from "./caller"

const ADMIN_USERS = (process.env.SNOWDASH_ADMIN_USERS ?? "")
  .split(",")
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean)
const SERVICE_USER = (process.env.SNOWDASH_SERVICE_USER ?? "").trim().toUpperCase()

/**
 * Marks the listing query itself so it can exclude only itself (other QUERY_HISTORY calls stay
 * visible). A string literal, because Snowflake drops leading comments from QUERY_TEXT.
 */
const LIST_MARKER = "snowdash:admin-list"

export interface ServiceQuery {
  queryId: string
  user: string
  role: string | null
  warehouse: string | null
  status: string
  startTime: string
  minutes: number
  sql: string
}

export async function assertAdmin(): Promise<void> {
  const who = (await callerKey()).toUpperCase()
  if (!ADMIN_USERS.includes(who)) throw new AppError("e.notAdmin")
}

async function serviceUser(): Promise<string> {
  const rows = await querySnowflake("SELECT CURRENT_USER() AS U")
  const user = String(rows[0]?.U ?? "")
  if (SERVICE_USER && user.toUpperCase() !== SERVICE_USER) {
    throw new AppError("e.wrongServiceUser", { user, expected: SERVICE_USER })
  }
  return user
}

/** How far back to look (hours). QUERY_HISTORY is slow over long ranges (~5 min for 7 days). */
export const DEFAULT_HOURS = 24
const MAX_HOURS = 167 // INFORMATION_SCHEMA.QUERY_HISTORY keeps 7 days

export function clampHours(v: unknown): number {
  const n = Math.floor(Number(v ?? DEFAULT_HOURS))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, MAX_HOURS) : DEFAULT_HOURS
}

/** The service user's queries still running, queued or blocked in the last `hours`. */
export async function listServiceQueries(hours = DEFAULT_HOURS): Promise<{ serviceUser: string; hours: number; queries: ServiceQuery[] }> {
  const user = await serviceUser()
  const h = clampHours(hours)
  const rows = await querySnowflakeLongRunning(
    `SELECT '${LIST_MARKER}' AS ADMIN_MARK, QUERY_ID, USER_NAME, ROLE_NAME, WAREHOUSE_NAME, EXECUTION_STATUS, START_TIME,
            DATEDIFF('second', START_TIME, CURRENT_TIMESTAMP()) / 60 AS MINUTES,
            LEFT(QUERY_TEXT, 300) AS SQL_HEAD
       FROM TABLE(INFORMATION_SCHEMA.QUERY_HISTORY(
              END_TIME_RANGE_START => DATEADD(hour, -${h}, CURRENT_TIMESTAMP()), RESULT_LIMIT => 10000))
      WHERE USER_NAME = CURRENT_USER()
        AND EXECUTION_STATUS IN ('RUNNING', 'QUEUED', 'BLOCKED', 'RESUMING_WAREHOUSE')
        AND QUERY_TEXT NOT ILIKE '%${LIST_MARKER}%'
      ORDER BY START_TIME`,
    { maxWaitMs: 10 * 60 * 1000 },
  )
  return {
    serviceUser: user,
    hours: h,
    queries: rows.map((r) => ({
      queryId: String(r.QUERY_ID),
      user: String(r.USER_NAME),
      role: r.ROLE_NAME == null ? null : String(r.ROLE_NAME),
      warehouse: r.WAREHOUSE_NAME == null ? null : String(r.WAREHOUSE_NAME),
      status: String(r.EXECUTION_STATUS),
      startTime: r.START_TIME instanceof Date ? r.START_TIME.toISOString() : String(r.START_TIME),
      minutes: Math.floor(Number(r.MINUTES)),
      sql: String(r.SQL_HEAD ?? ""),
    })),
  }
}

export interface CancelFilter {
  /** Cancel exactly these queries (each must still be one of the service user's in-flight queries). */
  queryIds?: string[]
  /** Otherwise: cancel those running/queued for at least this many minutes… */
  minMinutes?: number
  /** …optionally only on this warehouse. */
  warehouse?: string
}

const QUERY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Cancel service-user queries. The candidates always come from a fresh listing, so an id that is
 * not (or no longer) one of the service user's in-flight queries is never sent to Snowflake.
 */
export async function cancelServiceQueries(filter: CancelFilter, hours = DEFAULT_HOURS) {
  const ids = filter.queryIds?.filter((id) => QUERY_ID_RE.test(id))
  if (filter.queryIds && !ids?.length) throw new AppError("e.noQueriesSelected")
  const { serviceUser: user, hours: h, queries } = await listServiceQueries(hours)
  const mine = queries.filter((q) => q.user === user)
  const targets = ids
    ? mine.filter((q) => ids.includes(q.queryId))
    : mine.filter((q) => q.minutes >= (filter.minMinutes ?? 0) && (!filter.warehouse || q.warehouse === filter.warehouse))
  const results = await Promise.all(
    targets.map(async (q) => {
      try {
        const r = await querySnowflake("SELECT SYSTEM$CANCEL_QUERY(?) AS R", { binds: [q.queryId] })
        return { queryId: q.queryId, warehouse: q.warehouse, minutes: q.minutes, result: String(r[0]?.R ?? "") }
      } catch (e) {
        return { queryId: q.queryId, warehouse: q.warehouse, minutes: q.minutes, result: `error: ${e instanceof Error ? e.message : String(e)}` }
      }
    }),
  )
  const notFound = ids ? ids.filter((id) => !targets.some((q) => q.queryId === id)) : []
  return { serviceUser: user, hours: h, cancelled: results, notFound }
}

/** Whether the calling login may use the admin tools (drives the header button). */
export async function isAdmin(): Promise<boolean> {
  return ADMIN_USERS.includes((await callerKey()).toUpperCase())
}

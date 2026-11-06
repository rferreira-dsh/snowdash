/**
 * Shelf size limits (rows / columns / values) for a pivot.
 *
 *   SNOWDASH_LIMITS_DEFAULT  "rows,columns,values"  limits everyone gets (default 8,4,12)
 *   SNOWDASH_LIMITS_MAX      "rows,columns,values"  hard ceiling, admins only (default 16,8,30)
 *
 * A sheet may carry its own `spec.limits`; the server clamps them to the default for
 * regular users and to the ceiling for logins in SNOWDASH_ADMIN_USERS.
 */

import type { FieldLimits } from "./types"

const FALLBACK_DEFAULT: FieldLimits = { rows: 8, columns: 4, values: 12 }
const FALLBACK_MAX: FieldLimits = { rows: 16, columns: 8, values: 30 }

function parseEnv(raw: string | undefined, fallback: FieldLimits): FieldLimits {
  const parts = (raw ?? "").split(",").map((s) => Number(s.trim()))
  const pick = (i: number, fb: number) => (Number.isInteger(parts[i]) && parts[i] > 0 ? parts[i] : fb)
  return { rows: pick(0, fallback.rows), columns: pick(1, fallback.columns), values: pick(2, fallback.values) }
}

const KEYS = ["rows", "columns", "values"] as const

export function configuredLimits(): { default: FieldLimits; max: FieldLimits } {
  const max = parseEnv(process.env.SNOWDASH_LIMITS_MAX, FALLBACK_MAX)
  const def = parseEnv(process.env.SNOWDASH_LIMITS_DEFAULT, FALLBACK_DEFAULT)
  // The default can never exceed the ceiling.
  for (const k of KEYS) def[k] = Math.min(def[k], max[k])
  return { default: def, max }
}

/** Effective limits for a request: requested values clamped to what the caller may use. */
export function resolveLimits(requested: unknown, admin: boolean): FieldLimits {
  const { default: def, max } = configuredLimits()
  const cap = admin ? max : def
  const req = (requested ?? {}) as Partial<Record<keyof FieldLimits, unknown>>
  const out = { ...def }
  for (const k of KEYS) {
    const v = Number(req[k])
    if (Number.isInteger(v) && v > 0) out[k] = Math.min(v, cap[k])
  }
  return out
}

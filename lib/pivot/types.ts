/** Shared types between the pivot API routes and the client workbench. */

export type SourceKind = "TABLE" | "VIEW" | "SEMANTIC_VIEW" | "MODEL"

export type JoinType = "LEFT" | "INNER"

export interface ModelTable {
  database: string
  schema: string
  name: string
  /** Unique alias inside the model; also the field-id prefix (ALIAS.COLUMN). */
  alias: string
  /** How this table attaches to one already in the model (absent for the base table). */
  join?: {
    toAlias: string
    type: JoinType
    /** left = column of `toAlias`, right = column of this table. */
    pairs: { left: string; right: string }[]
  }
}

export interface DataModel {
  tables: ModelTable[]
}

export interface Source {
  database: string
  schema: string
  name: string
  kind: SourceKind
  /** Only for kind = MODEL (database/schema/name mirror the base table). */
  model?: DataModel
}

export const MAX_MODEL_TABLES = 8

export type FieldRole = "dimension" | "measure" | "metric"
export type FieldFamily = "number" | "date" | "text" | "boolean" | "other"

export interface Field {
  /** Unique key within the source: column name for tables, ENTITY.NAME for semantic views. */
  id: string
  name: string
  /** Logical table (semantic views only). */
  entity?: string
  role: FieldRole
  dataType: string
  family: FieldFamily
  description?: string
}

export const COUNT_ROWS_ID = "__COUNT_ROWS__"

export type Grain = "day" | "week" | "month" | "quarter" | "year"
export const GRAINS: Grain[] = ["day", "week", "month", "quarter", "year"]

export type Agg = "SUM" | "AVG" | "MIN" | "MAX" | "COUNT" | "COUNT_DISTINCT" | "METRIC"
export const TABLE_AGGS: Agg[] = ["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT"]

export type FilterOp =
  | "in"
  | "not_in"
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "contains"
  | "is_null"
  | "not_null"

export interface DimRef {
  fieldId: string
  grain?: Grain
}

export interface ValueRef {
  fieldId: string
  agg: Agg
}

export interface FilterRef {
  fieldId: string
  op: FilterOp
  values: (string | number)[]
}

export type SortDir = "asc" | "desc"

export interface PivotSpec {
  rows: DimRef[]
  columns: DimRef[]
  values: ValueRef[]
  filters: FilterRef[]
  totals: boolean
  limit: number
}

export interface PivotRequest {
  source: Source
  spec: PivotSpec
}

/**
 * Long-format result: one row per (row combo, column combo).
 * Keys: r0..rn (row dims), c0..cn (column dims), v0..vn (values),
 * __gr / __gc = 1 when that row is a total over rows / columns.
 */
export interface PivotResponse {
  sql: string
  rows: Record<string, unknown>[]
  truncated: boolean
  elapsedMs: number
}

export const MAX_LIMIT = 50000
export const DEFAULT_LIMIT = 10000

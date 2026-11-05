/**
 * Extract the parts of a Tableau workbook (.twb XML) that SnowDash can use.
 * Output is a plain, Tableau-shaped structure; mapping to SnowDash lives in convert.ts.
 */

import { childText, descendants, kid, kids, parseXml, path, type XNode } from "./xml"

export interface TwbObject {
  /** object-graph id, or the relation name for physical-only datasources. */
  id: string
  caption: string
  /** Relation name used by metadata-records ([parent-name]). */
  relation: string
  database: string
  schema: string
  table: string
}

/** One side of a join/relationship condition, as a Tableau field expression. */
export interface TwbJoinPair {
  left: string
  right: string
}

export interface TwbRelationship {
  /** Object ids (first/second end point). Empty for physical joins resolved by field. */
  first: string
  second: string
  pairs: TwbJoinPair[]
  /** physical join type; logical relationships have none. */
  joinType?: string
}

/** A field as Tableau knows it (local name `[X]`). */
export interface TwbColumn {
  local: string
  remote?: string
  relation?: string
  objectId?: string
  caption?: string
  role?: string
  datatype?: string
  hidden?: boolean
  formula?: string
}

export interface TwbFolder {
  name: string
  items: string[]
}

export interface TwbDatasource {
  name: string
  caption: string
  connectionClass: string
  database: string
  schema: string
  warehouse: string
  objects: TwbObject[]
  relationships: TwbRelationship[]
  customSql: string[]
  columns: TwbColumn[]
  folders: TwbFolder[]
}

export interface TwbParameter {
  local: string
  caption: string
  value: string
}

export interface TwbFilter {
  /** Field instance token, e.g. `none:Claim Number:nk`. */
  column: string
  cls: string
  members: string[]
  exclude: boolean
  min?: string
  max?: string
}

export interface TwbWorksheet {
  name: string
  datasource: string
  rows: string[]
  cols: string[]
  rowTotal: boolean
  colTotal: boolean
  filters: TwbFilter[]
  /** Measure Names order (manual sort) and members (filter) as field-instance tokens. */
  measureNames: string[]
  /** Field instances on mark encodings (text/color/size…). */
  encodings: string[]
  mark: string
  /** Worksheet-local columns (calcs defined inside the sheet). */
  columns: TwbColumn[]
}

export interface TwbWorkbook {
  datasources: TwbDatasource[]
  parameters: TwbParameter[]
  worksheets: TwbWorksheet[]
}

/** `[A].[B].[C]` → ["A","B","C"] (Tableau doubles `]` inside names). */
export function splitBrackets(s: string): string[] {
  const out: string[] = []
  const re = /\[((?:[^\]]|\]\])*)\]/g
  for (let m = re.exec(s); m; m = re.exec(s)) out.push(m[1].replace(/\]\]/g, "]"))
  return out.length ? out : s ? [s] : []
}

/** Field-instance references on a shelf/encoding: `[ds].[inst]` → { ds, inst }. */
export function shelfTokens(s: string): { ds: string; inst: string }[] {
  const out: { ds: string; inst: string }[] = []
  // `[ds].[x]` or `[ds].[__tableau_internal_object_id__].[cnt:…]` — the instance is the last part.
  const re = /\[((?:[^\]]|\]\])*)\]((?:\.\[(?:[^\]]|\]\])*\])+)/g
  for (let m = re.exec(s); m; m = re.exec(s)) {
    out.push({ ds: m[1].replace(/\]\]/g, "]"), inst: splitBrackets(m[2]).pop() ?? "" })
  }
  return out
}

const br = (s: string) => (s.startsWith("[") ? s : `[${s}]`)

function tableParts(table: string, dbDefault: string, schemaDefault: string) {
  const p = splitBrackets(table)
  if (p.length >= 3) return { database: p[p.length - 3], schema: p[p.length - 2], table: p[p.length - 1] }
  if (p.length === 2) return { database: dbDefault, schema: p[0], table: p[1] }
  return { database: dbDefault, schema: schemaDefault, table: p[0] ?? "" }
}

/** `<expression op='='><expression op='[A]'/>…` → pairs; nested AND supported. */
function exprPairs(e: XNode | undefined): TwbJoinPair[] {
  if (!e) return []
  const op = e.attrs.op ?? ""
  const subs = kids(e, "expression")
  if (op === "=" && subs.length === 2) return [{ left: subs[0].attrs.op ?? "", right: subs[1].attrs.op ?? "" }]
  if (/^and$/i.test(op)) return subs.flatMap(exprPairs)
  return []
}

function readConnection(ds: XNode) {
  const conn = kid(ds, "connection")
  // federated → named-connections/named-connection/connection carries the real class.
  const inner = descendants(conn, "connection").find((c) => c.attrs.class && c.attrs.class !== "federated")
  const c = inner ?? conn
  return {
    conn,
    cls: c?.attrs.class ?? "",
    database: c?.attrs.dbname ?? "",
    schema: c?.attrs.schema ?? "",
    warehouse: c?.attrs.warehouse ?? "",
  }
}

/** Physical layer: walk `<relation>` trees (tables, joins, custom SQL). */
function walkRelations(
  rel: XNode | undefined,
  db: string,
  sc: string,
  objects: TwbObject[],
  rels: TwbRelationship[],
  customSql: string[],
) {
  if (!rel) return
  const type = rel.attrs.type
  if (type === "table") {
    const name = rel.attrs.name ?? ""
    if (!objects.some((o) => o.relation === name)) {
      objects.push({ id: name, caption: name, relation: name, ...tableParts(rel.attrs.table ?? name, db, sc) })
    }
  } else if (type === "text") {
    customSql.push(`${rel.attrs.name ?? ""}: ${rel.text.trim()}`)
  } else if (type === "join") {
    for (const r of kids(rel, "relation")) walkRelations(r, db, sc, objects, rels, customSql)
    const clause = kid(rel, "clause")
    rels.push({ first: "", second: "", pairs: exprPairs(kid(clause, "expression")), joinType: rel.attrs.join ?? "inner" })
  } else {
    for (const r of kids(rel, "relation")) walkRelations(r, db, sc, objects, rels, customSql)
  }
}

function readColumns(parent: XNode | undefined): TwbColumn[] {
  return kids(parent, "column").map((c) => ({
    local: c.attrs.name ?? "",
    caption: c.attrs.caption,
    role: c.attrs.role,
    datatype: c.attrs.datatype,
    hidden: c.attrs.hidden === "true",
    formula: kid(c, "calculation")?.attrs.formula,
  }))
}

function readDatasource(ds: XNode): TwbDatasource {
  const { conn, cls, database, schema, warehouse } = readConnection(ds)
  const objects: TwbObject[] = []
  const relationships: TwbRelationship[] = []
  const customSql: string[] = []

  const graph = kid(ds, "object-graph") ?? descendants(ds, "object-graph")[0]
  if (graph) {
    for (const o of kids(kid(graph, "objects"), "object")) {
      const rel = descendants(o, "relation").find((r) => r.attrs.type === "table")
      const sql = descendants(o, "relation").find((r) => r.attrs.type === "text")
      if (sql) customSql.push(`${o.attrs.caption ?? o.attrs.id}: ${sql.text.trim()}`)
      if (!rel) continue
      objects.push({
        id: o.attrs.id ?? "",
        caption: o.attrs.caption ?? rel.attrs.name ?? "",
        relation: rel.attrs.name ?? "",
        ...tableParts(rel.attrs.table ?? "", database, schema),
      })
      // Physical joins inside a logical object.
      const join = descendants(o, "relation").filter((r) => r.attrs.type === "join")
      for (const j of join) walkRelations(j, database, schema, objects, relationships, customSql)
    }
    for (const r of kids(kid(graph, "relationships"), "relationship")) {
      relationships.push({
        first: kid(r, "first-end-point")?.attrs["object-id"] ?? "",
        second: kid(r, "second-end-point")?.attrs["object-id"] ?? "",
        pairs: exprPairs(kid(r, "expression")),
      })
    }
  } else {
    for (const r of kids(conn, "relation")) walkRelations(r, database, schema, objects, relationships, customSql)
  }

  // Column → table mapping: metadata-records first, then <cols><map>.
  const columns = new Map<string, TwbColumn>()
  for (const m of descendants(conn, "metadata-record")) {
    if (m.attrs.class !== "column") continue
    const local = childText(m, "local-name")
    if (!local) continue
    columns.set(local, {
      local,
      remote: childText(m, "remote-name"),
      relation: splitBrackets(childText(m, "parent-name"))[0],
      objectId: splitBrackets(childText(m, "object-id"))[0],
      datatype: childText(m, "local-type"),
    })
  }
  for (const m of kids(kid(conn, "cols"), "map")) {
    const local = m.attrs.key ?? ""
    if (columns.has(local)) continue
    const [relation, remote] = splitBrackets(m.attrs.value ?? "")
    columns.set(local, { local, relation, remote })
  }
  for (const c of readColumns(ds)) {
    if (!c.local) continue
    const prev = columns.get(c.local)
    columns.set(c.local, { ...prev, ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)), local: c.local })
  }

  // Folders: <folders-common> (2020+) or <folder> directly under the datasource.
  const folderNodes = [...kids(kid(ds, "folders-common"), "folder"), ...kids(ds, "folder")]
  const folders = folderNodes.map((f) => ({
    name: f.attrs.name ?? "",
    items: kids(f, "folder-item").map((i) => i.attrs.name ?? "").filter(Boolean),
  }))

  return {
    name: ds.attrs.name ?? "",
    caption: ds.attrs.caption ?? ds.attrs.name ?? "",
    connectionClass: cls,
    database,
    schema,
    warehouse,
    objects,
    relationships,
    customSql,
    columns: [...columns.values()],
    folders,
  }
}

function readFilters(view: XNode | undefined): { filters: TwbFilter[]; measureMembers: string[] } {
  const filters: TwbFilter[] = []
  let measureMembers: string[] = []
  for (const f of kids(view, "filter")) {
    const column = splitBrackets(f.attrs.column ?? "").pop() ?? ""
    const groups = descendants(f, "groupfilter")
    const members = groups
      .filter((g) => g.attrs.function === "member")
      .map((g) => g.attrs.member ?? "")
    const exclude =
      groups.some((g) => g.attrs.function === "except") ||
      groups.some((g) => g.attrs["user:ui-enumeration"] === "exclusive")
    if (column === ":Measure Names") {
      measureMembers = members.map((m) => shelfTokens(m.replace(/^"|"$/g, ""))[0]?.inst ?? "").filter(Boolean)
      continue
    }
    filters.push({
      column,
      cls: f.attrs.class ?? "",
      members,
      exclude,
      min: kid(f, "min")?.text.trim(),
      max: kid(f, "max")?.text.trim(),
    })
  }
  return { filters, measureMembers }
}

function readWorksheet(w: XNode): TwbWorksheet {
  const table = kid(w, "table")
  const view = kid(table, "view")
  const rowsNode = kid(table, "rows")
  const colsNode = kid(table, "cols")
  const { filters, measureMembers } = readFilters(view)
  const sortNode = kids(view, "manual-sort").find((s) => (s.attrs.column ?? "").endsWith("[:Measure Names]"))
  const sorted = descendants(sortNode, "bucket").map((b) => shelfTokens(b.text.trim().replace(/^"|"$/g, ""))[0]?.inst ?? "")
  const measureNames = sorted.filter((s) => s && measureMembers.includes(s))
  for (const m of measureMembers) if (!measureNames.includes(m)) measureNames.push(m)
  const pane = descendants(table, "pane")[0]
  const enc = (kid(pane, "encodings")?.children ?? [])
    .filter((e) => e.tag !== "tooltip" && e.tag !== "lod")
    .flatMap((e) => shelfTokens(e.attrs.column ?? "").map((t) => t.inst))
  const deps = kids(view, "datasource-dependencies")
  return {
    name: w.attrs.name ?? "",
    datasource: kids(path(view, "datasources"), "datasource")[0]?.attrs.name ?? "",
    rows: shelfTokens(rowsNode?.text ?? "").map((t) => t.inst),
    cols: shelfTokens(colsNode?.text ?? "").map((t) => t.inst),
    rowTotal: rowsNode?.attrs.total === "true",
    colTotal: colsNode?.attrs.total === "true",
    filters,
    measureNames,
    encodings: enc,
    mark: kid(pane, "mark")?.attrs.class ?? "Automatic",
    columns: deps.flatMap((d) => readColumns(d)).filter((c) => c.formula),
  }
}

export function parseTwb(xml: string): TwbWorkbook {
  const root = parseXml(xml)
  const wb = kid(root, "workbook")
  if (!wb) throw new Error("not a Tableau workbook (.twb)")
  const all = kids(kid(wb, "datasources"), "datasource")
  const params = all.find((d) => d.attrs.name === "Parameters")
  return {
    datasources: all.filter((d) => d !== params).map(readDatasource),
    parameters: kids(params, "column").map((c) => ({
      local: c.attrs.name ?? "",
      caption: c.attrs.caption ?? c.attrs.name ?? "",
      value: c.attrs.value ?? "",
    })),
    worksheets: kids(kid(wb, "worksheets"), "worksheet").map(readWorksheet),
  }
}

export { br as bracket }

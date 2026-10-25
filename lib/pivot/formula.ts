/**
 * Calculated-metric formulas: tokenizer + recursive-descent parser + SQL renderer.
 *
 * Grammar (case-insensitive keywords):
 *   expr    := or
 *   or      := and (OR and)*
 *   and     := not (AND not)*
 *   not     := NOT not | cmp
 *   cmp     := add ((= | <> | != | < | <= | > | >=) add)?
 *   add     := mul ((+ | -) mul)*
 *   mul     := unary ((* | /) unary)*
 *   unary   := - unary | primary
 *   primary := NUMBER | 'string' | NULL | TRUE | FALSE | [field] | FUNC(args) | (expr)
 *
 * Safety: there is no way to emit raw SQL. Field references are resolved against the
 * source's real fields and quoted; functions come from a closed allow-list; string
 * literals are escaped; numbers are validated. Division renders as `a / NULLIF(b, 0)`.
 */

import { AppError } from "../i18n/messages"
import type { Field } from "./types"

export class FormulaError extends AppError {}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

export type Node =
  | { t: "num"; v: string }
  | { t: "str"; v: string }
  | { t: "lit"; v: "NULL" | "TRUE" | "FALSE" }
  | { t: "field"; ref: string }
  | { t: "neg"; e: Node }
  | { t: "not"; e: Node }
  | { t: "bin"; op: string; l: Node; r: Node }
  | { t: "call"; fn: string; args: Node[] }

export const AGG_FUNCS = ["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT", "COUNT_ROWS"] as const
const SCALAR_FUNCS: Record<string, [number, number]> = {
  IF: [3, 3],
  COALESCE: [2, 10],
  NULLIF: [2, 2],
  ROUND: [1, 2],
  ABS: [1, 1],
}
const ARITY: Record<string, [number, number]> = {
  SUM: [1, 1],
  AVG: [1, 1],
  MIN: [1, 1],
  MAX: [1, 1],
  COUNT: [1, 1],
  COUNT_DISTINCT: [1, 1],
  COUNT_ROWS: [0, 0],
  ...SCALAR_FUNCS,
}
export const FORMULA_FUNCS = Object.keys(ARITY)

const MAX_LEN = 2000
const MAX_DEPTH = 40

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type Tok =
  | { k: "num"; v: string; p: number }
  | { k: "str"; v: string; p: number }
  | { k: "field"; v: string; p: number }
  | { k: "id"; v: string; p: number }
  | { k: "op"; v: string; p: number }
  | { k: "eof"; p: number }

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (/[0-9.]/.test(c)) {
      const m = /^(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))
      if (!m) throw new FormulaError("f.badNumber", { pos: i + 1 })
      out.push({ k: "num", v: m[0], p: i })
      i += m[0].length
      continue
    }
    if (c === "'") {
      let j = i + 1
      let s = ""
      for (;;) {
        if (j >= src.length) throw new FormulaError("f.unclosedString", { pos: i + 1 })
        if (src[j] === "'") {
          if (src[j + 1] === "'") {
            s += "'"
            j += 2
            continue
          }
          break
        }
        s += src[j++]
      }
      out.push({ k: "str", v: s, p: i })
      i = j + 1
      continue
    }
    if (c === "[") {
      const j = src.indexOf("]", i + 1)
      if (j < 0) throw new FormulaError("f.unclosedField", { pos: i + 1 })
      const name = src.slice(i + 1, j).trim()
      if (!name) throw new FormulaError("f.emptyField", { pos: i + 1 })
      out.push({ k: "field", v: name, p: i })
      i = j + 1
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!
      out.push({ k: "id", v: m[0].toUpperCase(), p: i })
      i += m[0].length
      continue
    }
    const two = src.slice(i, i + 2)
    if (["<=", ">=", "<>", "!="].includes(two)) {
      out.push({ k: "op", v: two === "!=" ? "<>" : two, p: i })
      i += 2
      continue
    }
    if ("+-*/(),=<>".includes(c)) {
      out.push({ k: "op", v: c, p: i })
      i++
      continue
    }
    throw new FormulaError("f.badChar", { ch: c, pos: i + 1 })
  }
  out.push({ k: "eof", p: src.length })
  return out
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export function parseFormula(src: string): Node {
  if (typeof src !== "string" || !src.trim()) throw new FormulaError("f.empty")
  if (src.length > MAX_LEN) throw new FormulaError("f.tooLong", { n: MAX_LEN })
  const toks = tokenize(src)
  let pos = 0
  let depth = 0
  const peek = () => toks[pos]
  const next = () => toks[pos++]
  const isOp = (v: string) => peek().k === "op" && (peek() as { v: string }).v === v
  const isKw = (v: string) => peek().k === "id" && (peek() as { v: string }).v === v
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError("f.expected", { tok: v, pos: peek().p + 1 })
    pos++
  }
  const guard = <T,>(fn: () => T): T => {
    if (++depth > MAX_DEPTH) throw new FormulaError("f.tooDeep")
    try {
      return fn()
    } finally {
      depth--
    }
  }

  const expr = (): Node => guard(or)
  const or = (): Node => {
    let l = and()
    while (isKw("OR")) {
      next()
      l = { t: "bin", op: "OR", l, r: and() }
    }
    return l
  }
  const and = (): Node => {
    let l = not()
    while (isKw("AND")) {
      next()
      l = { t: "bin", op: "AND", l, r: not() }
    }
    return l
  }
  const not = (): Node => {
    if (isKw("NOT")) {
      next()
      return guard(() => ({ t: "not", e: not() }))
    }
    return cmp()
  }
  const cmp = (): Node => {
    const l = add()
    for (const op of ["=", "<>", "<=", ">=", "<", ">"]) {
      if (isOp(op)) {
        next()
        return { t: "bin", op, l, r: add() }
      }
    }
    return l
  }
  const add = (): Node => {
    let l = mul()
    while (isOp("+") || isOp("-")) {
      const op = (next() as { v: string }).v
      l = { t: "bin", op, l, r: mul() }
    }
    return l
  }
  const mul = (): Node => {
    let l = unary()
    while (isOp("*") || isOp("/")) {
      const op = (next() as { v: string }).v
      l = { t: "bin", op, l, r: unary() }
    }
    return l
  }
  const unary = (): Node => {
    if (isOp("-")) {
      next()
      return guard(() => ({ t: "neg", e: unary() }))
    }
    return primary()
  }
  const primary = (): Node => {
    const tok = next()
    switch (tok.k) {
      case "num":
        return { t: "num", v: tok.v }
      case "str":
        return { t: "str", v: tok.v }
      case "field":
        return { t: "field", ref: tok.v }
      case "op":
        if (tok.v === "(") {
          const e = expr()
          expect(")")
          return e
        }
        throw new FormulaError("f.unexpected", { tok: tok.v, pos: tok.p + 1 })
      case "id": {
        if (tok.v === "NULL" || tok.v === "TRUE" || tok.v === "FALSE") return { t: "lit", v: tok.v }
        const arity = ARITY[tok.v]
        if (!arity) throw new FormulaError("f.unknownFunc", { fn: tok.v, list: FORMULA_FUNCS.join(", ") })
        expect("(")
        const args: Node[] = []
        if (!isOp(")")) {
          args.push(expr())
          while (isOp(",")) {
            next()
            args.push(expr())
          }
        }
        expect(")")
        if (args.length < arity[0] || args.length > arity[1]) {
          throw new FormulaError("f.arity", { fn: tok.v, n: arity[0] === arity[1] ? arity[0] : `${arity[0]}–${arity[1]}` })
        }
        return { t: "call", fn: tok.v, args }
      }
      default:
        throw new FormulaError("f.unexpectedEnd")
    }
  }

  const ast = expr()
  if (peek().k !== "eof") {
    const tk = peek() as { v?: string; p: number }
    throw new FormulaError("f.unexpected", { tok: tk.v ?? "?", pos: tk.p + 1 })
  }
  return ast
}

// ---------------------------------------------------------------------------
// Field resolution
// ---------------------------------------------------------------------------

/** Resolve [ref] by exact id, then case-insensitive id, then unique case-insensitive name. */
export function resolveField(ref: string, fields: Field[]): Field {
  const exact = fields.find((f) => f.id === ref)
  if (exact) return exact
  const up = ref.toUpperCase()
  const byId = fields.filter((f) => f.id.toUpperCase() === up)
  if (byId.length === 1) return byId[0]
  const byName = fields.filter((f) => f.name.toUpperCase() === up)
  if (byName.length === 1) return byName[0]
  if (byName.length > 1) {
    throw new FormulaError("f.ambiguous", { ref, options: byName.map((f) => `[${f.id}]`).join(", ") })
  }
  throw new FormulaError("f.unknownField", { ref })
}

/** Field ids referenced by a formula (resolved). */
export function formulaFields(ast: Node, fields: Field[]): Field[] {
  const out = new Map<string, Field>()
  const walk = (n: Node) => {
    if (n.t === "field") {
      const f = resolveField(n.ref, fields)
      out.set(f.id, f)
    } else if (n.t === "neg" || n.t === "not") walk(n.e)
    else if (n.t === "bin") {
      walk(n.l)
      walk(n.r)
    } else if (n.t === "call") n.args.forEach(walk)
  }
  walk(ast)
  return [...out.values()]
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function sqlString(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`
}

interface RenderCtx {
  /** Column SQL for a field (only called where field refs are allowed). */
  col: (f: Field) => string
  fields: Field[]
  /** "table": refs must sit inside aggregates; "metrics": refs must be metrics, no aggregates. */
  mode: "table" | "metrics"
}

function render(n: Node, ctx: RenderCtx, inAgg: boolean): string {
  switch (n.t) {
    case "num":
      return n.v
    case "str":
      return sqlString(n.v)
    case "lit":
      return n.v
    case "field": {
      const f = resolveField(n.ref, ctx.fields)
      if (ctx.mode === "table") {
        if (!inAgg) throw new FormulaError("f.needAgg", { ref: n.ref })
        if (f.role === "metric") throw new FormulaError("f.metricInTable", { ref: n.ref })
      } else if (f.role !== "metric") {
        throw new FormulaError("f.needMetric", { ref: n.ref })
      }
      return ctx.col(f)
    }
    case "neg":
      return `(-${render(n.e, ctx, inAgg)})`
    case "not":
      return `(NOT ${render(n.e, ctx, inAgg)})`
    case "bin": {
      const l = render(n.l, ctx, inAgg)
      const r = render(n.r, ctx, inAgg)
      if (n.op === "/") return `(${l} / NULLIF(${r}, 0))`
      return `(${l} ${n.op} ${r})`
    }
    case "call": {
      const isAgg = (AGG_FUNCS as readonly string[]).includes(n.fn)
      if (isAgg) {
        if (ctx.mode === "metrics") throw new FormulaError("f.noAggInSV", { fn: n.fn })
        if (inAgg) throw new FormulaError("f.nestedAgg", { fn: n.fn })
        if (n.fn === "COUNT_ROWS") return "COUNT(*)"
        const a = render(n.args[0], ctx, true)
        return n.fn === "COUNT_DISTINCT" ? `COUNT(DISTINCT ${a})` : `${n.fn}(${a})`
      }
      const args = n.args.map((a) => render(a, ctx, inAgg))
      if (n.fn === "IF") return `IFF(${args[0]}, ${args[1]}, ${args[2]})`
      return `${n.fn}(${args.join(", ")})`
    }
  }
}

/** SQL for a calculated metric over a table/view/model (aggregates over row-level columns). */
export function renderTableFormula(ast: Node, fields: Field[], col: (f: Field) => string): string {
  return render(ast, { fields, col, mode: "table" }, false)
}

/** SQL for a calculated metric over semantic-view metrics, given each metric's output column. */
export function renderMetricsFormula(ast: Node, fields: Field[], col: (f: Field) => string): string {
  return render(ast, { fields, col, mode: "metrics" }, false)
}

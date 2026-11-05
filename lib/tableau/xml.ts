/**
 * Minimal, dependency-free XML parser — enough for Tableau .twb files.
 * Handles elements, attributes ('…' or "…"), text, self-closing tags, comments,
 * CDATA, processing instructions and the standard/numeric entities.
 * Not a validating parser: unbalanced closing tags are tolerated.
 */

export interface XNode {
  tag: string
  attrs: Record<string, string>
  children: XNode[]
  text: string
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

export function parseXml(src: string): XNode {
  const root: XNode = { tag: "#root", attrs: {}, children: [], text: "" }
  const stack: XNode[] = [root]
  let i = 0
  const n = src.length
  while (i < n) {
    const lt = src.indexOf("<", i)
    const top = stack[stack.length - 1]
    if (lt < 0) {
      top.text += decodeEntities(src.slice(i))
      break
    }
    if (lt > i) top.text += decodeEntities(src.slice(i, lt))
    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4)
      i = end < 0 ? n : end + 3
    } else if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9)
      top.text += src.slice(lt + 9, end < 0 ? n : end)
      i = end < 0 ? n : end + 3
    } else if (src[lt + 1] === "?" || src[lt + 1] === "!") {
      const end = src.indexOf(">", lt)
      i = end < 0 ? n : end + 1
    } else if (src[lt + 1] === "/") {
      const end = src.indexOf(">", lt)
      const tag = src.slice(lt + 2, end < 0 ? n : end).trim()
      // Pop to the matching open tag (tolerate stray closers).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) {
          stack.length = k
          break
        }
      }
      i = end < 0 ? n : end + 1
    } else {
      // Find the tag end, skipping '>' inside quoted attribute values.
      let j = lt + 1
      let q: string | null = null
      for (; j < n; j++) {
        const c = src[j]
        if (q) {
          if (c === q) q = null
        } else if (c === '"' || c === "'") q = c
        else if (c === ">") break
      }
      let body = src.slice(lt + 1, j)
      const selfClose = body.endsWith("/")
      if (selfClose) body = body.slice(0, -1)
      const m = /^[^\s/>]+/.exec(body)
      const tag = m ? m[0] : ""
      const attrs: Record<string, string> = {}
      ATTR_RE.lastIndex = tag.length
      for (let a = ATTR_RE.exec(body); a; a = ATTR_RE.exec(body)) {
        attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? "")
      }
      const node: XNode = { tag, attrs, children: [], text: "" }
      top.children.push(node)
      if (!selfClose) stack.push(node)
      i = j + 1
    }
  }
  return root
}

/** Direct children with the tag. */
export const kids = (n: XNode | undefined, tag: string): XNode[] => (n ? n.children.filter((c) => c.tag === tag) : [])
/** First direct child with the tag. */
export const kid = (n: XNode | undefined, tag: string): XNode | undefined => n?.children.find((c) => c.tag === tag)
/** Follow a path of direct-child tags. */
export function path(n: XNode | undefined, ...tags: string[]): XNode | undefined {
  let cur = n
  for (const t of tags) cur = kid(cur, t)
  return cur
}
/** All descendants with the tag (depth-first, document order); `stop` prunes subtrees. */
export function descendants(n: XNode | undefined, tag: string, stop?: (x: XNode) => boolean): XNode[] {
  const out: XNode[] = []
  const walk = (x: XNode) => {
    for (const c of x.children) {
      if (stop?.(c)) continue
      if (c.tag === tag) out.push(c)
      walk(c)
    }
  }
  if (n) walk(n)
  return out
}
/** Trimmed text of a child element. */
export const childText = (n: XNode | undefined, tag: string): string => kid(n, tag)?.text.trim() ?? ""

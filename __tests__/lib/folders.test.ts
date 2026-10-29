import { describe, expect, it } from "vitest"
import { moveToFolder, parseFolders, prefixFolders, pruneFolders } from "@/lib/pivot/folders"
import { parseSource } from "@/lib/pivot/catalog"
import type { FieldFolder } from "@/lib/pivot/types"

const base: FieldFolder[] = [
  { id: "a", name: "Vendas", fieldIds: ["X", "Y"] },
  { id: "b", name: "Cliente", fieldIds: ["Z"] },
]

describe("parseFolders", () => {
  it("accepts valid folders and dedupes field ids across folders", () => {
    const out = parseFolders([
      { id: "a", name: "  Vendas ", fieldIds: ["X", "Y"] },
      { id: "b", name: "Outros", fieldIds: ["Y", "Z"] },
    ])
    expect(out).toEqual([
      { id: "a", name: "Vendas", fieldIds: ["X", "Y"] },
      { id: "b", name: "Outros", fieldIds: ["Z"] },
    ])
  })

  it("rejects bad ids, empty names, duplicates and non-string fields", () => {
    expect(() => parseFolders([{ id: "bad id!", name: "x", fieldIds: [] }])).toThrow()
    expect(() => parseFolders([{ id: "a", name: " ", fieldIds: [] }])).toThrow()
    expect(() => parseFolders([{ id: "a", name: "x", fieldIds: [] }, { id: "a", name: "y", fieldIds: [] }])).toThrow()
    expect(() => parseFolders([{ id: "a", name: "x", fieldIds: [1] }])).toThrow()
    expect(() => parseFolders("nope")).toThrow()
  })

  it("is persisted through parseSource", () => {
    const src = parseSource({ database: "D", schema: "S", name: "T", kind: "TABLE", folders: base })
    expect(src.folders).toEqual(base)
    expect(parseSource({ database: "D", schema: "S", name: "T", kind: "TABLE" }).folders).toBeUndefined()
  })
})

describe("moveToFolder", () => {
  it("moves a field between folders", () => {
    const out = moveToFolder(base, "X", "b")
    expect(out[0].fieldIds).toEqual(["Y"])
    expect(out[1].fieldIds).toEqual(["Z", "X"])
  })

  it("inserts before a given field and reorders inside a folder", () => {
    expect(moveToFolder(base, "W", "a", "Y")[0].fieldIds).toEqual(["X", "W", "Y"])
    expect(moveToFolder(base, "Y", "a", "X")[0].fieldIds).toEqual(["Y", "X"])
  })

  it("removes from every folder when target is null", () => {
    const out = moveToFolder(base, "Z", null)
    expect(out[1].fieldIds).toEqual([])
    expect(out[0]).toBe(base[0])
  })
})

describe("prefixFolders / pruneFolders", () => {
  it("prefixes plain columns but not calcs or count rows", () => {
    const out = prefixFolders([{ id: "a", name: "n", fieldIds: ["COL", "calc:k1", "__COUNT_ROWS__"] }], "T1")
    expect(out?.[0].fieldIds).toEqual(["T1.COL", "calc:k1", "__COUNT_ROWS__"])
    expect(prefixFolders(undefined, "T1")).toBeUndefined()
  })

  it("drops missing ids", () => {
    expect(pruneFolders(base, (id) => id !== "Y")[0].fieldIds).toEqual(["X"])
  })
})

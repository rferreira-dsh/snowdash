/** Pure helpers for user-defined field folders (catalog panel organisation). */
import { AppError } from "../i18n/messages"
import { CALC_PREFIX, COUNT_ROWS_ID, MAX_FOLDERS, MAX_FOLDER_FIELDS, type FieldFolder } from "./types"

const FOLDER_ID_RE = /^[A-Za-z0-9_-]{1,40}$/

/** Server-side validation; a field id listed twice keeps only its first occurrence. */
export function parseFolders(input: unknown): FieldFolder[] {
  if (!Array.isArray(input) || input.length > MAX_FOLDERS) throw new AppError("e.badFolder")
  const ids = new Set<string>()
  const seen = new Set<string>()
  return input.map((raw) => {
    const f = (raw ?? {}) as Record<string, unknown>
    const id = String(f.id ?? "")
    const name = typeof f.name === "string" ? f.name.trim().slice(0, 100) : ""
    if (!FOLDER_ID_RE.test(id) || ids.has(id) || !name) throw new AppError("e.badFolder")
    if (!Array.isArray(f.fieldIds) || f.fieldIds.length > MAX_FOLDER_FIELDS) throw new AppError("e.badFolder")
    ids.add(id)
    const fieldIds: string[] = []
    for (const x of f.fieldIds) {
      if (typeof x !== "string" || !x || x.length > 600) throw new AppError("e.badFolder")
      if (seen.has(x)) continue
      seen.add(x)
      fieldIds.push(x)
    }
    return { id, name, fieldIds }
  })
}

/**
 * Move a field into `folderId`, before `beforeId` (at the end when absent/not found),
 * removing it from any other folder. `folderId = null` takes the field out of every folder.
 */
export function moveToFolder(folders: FieldFolder[], fieldId: string, folderId: string | null, beforeId?: string): FieldFolder[] {
  return folders.map((f) => {
    const rest = f.fieldIds.filter((x) => x !== fieldId)
    if (f.id !== folderId) return rest.length === f.fieldIds.length ? f : { ...f, fieldIds: rest }
    const i = beforeId ? rest.indexOf(beforeId) : -1
    const at = i < 0 ? rest.length : i
    return { ...f, fieldIds: [...rest.slice(0, at), fieldId, ...rest.slice(at)] }
  })
}

/** Prefix plain-table field ids with the model alias when a table becomes a model. */
export function prefixFolders(folders: FieldFolder[] | undefined, alias: string): FieldFolder[] | undefined {
  return folders?.map((f) => ({
    ...f,
    fieldIds: f.fieldIds.map((id) => (id.startsWith(CALC_PREFIX) || id === COUNT_ROWS_ID ? id : `${alias}.${id}`)),
  }))
}

/** Drop references to fields that no longer exist (e.g. a removed calc or model table). */
export function pruneFolders(folders: FieldFolder[], exists: (id: string) => boolean): FieldFolder[] {
  return folders.map((f) => (f.fieldIds.every(exists) ? f : { ...f, fieldIds: f.fieldIds.filter(exists) }))
}

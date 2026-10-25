export const DRAG_MIME = "application/x-snowdash-field"

export type ShelfId = "rows" | "columns" | "values" | "filters"

export interface DragPayload {
  fieldId: string
  /** Present when dragging an existing pill (move instead of add). */
  from?: { shelf: ShelfId; index: number }
}

export function readPayload(e: React.DragEvent): DragPayload | null {
  try {
    const raw = e.dataTransfer.getData(DRAG_MIME)
    return raw ? (JSON.parse(raw) as DragPayload) : null
  } catch {
    return null
  }
}

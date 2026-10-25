/**
 * One SnowBook.
 *   GET    /api/snowbooks/:id
 *   PUT    /api/snowbooks/:id  { name, description?, source, sheets }  (create or update)
 *   DELETE /api/snowbooks/:id
 */

import { errorResponse, messageResponse } from "@/lib/api"
import { deleteBook, getBook, saveBook } from "@/lib/snowbooks"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  try {
    const book = await getBook((await ctx.params).id)
    return book ? Response.json(book) : messageResponse(req, "e.bookNotFound", {}, 404)
  } catch (e) {
    return errorResponse(e, req, "snowbooks:get")
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    return Response.json(await saveBook((await ctx.params).id, await req.json()))
  } catch (e) {
    return errorResponse(e, req, "snowbooks:save")
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    await deleteBook((await ctx.params).id)
    return Response.json({ ok: true })
  } catch (e) {
    return errorResponse(e, req, "snowbooks:delete")
  }
}

/** Shared API error response: localized message, 400 for validation (AppError), 500 otherwise. */

import { AppError, errorText, requestLang, translate } from "./i18n/messages"

export function errorResponse(e: unknown, req: Request, tag: string, extra: Record<string, unknown> = {}) {
  const status = e instanceof AppError ? 400 : 500
  if (status === 500) console.error(new Date().toISOString(), `[${tag}]`, e)
  return Response.json({ error: errorText(e, requestLang(req)), ...extra }, { status })
}

export function messageResponse(req: Request, key: string, vars: Record<string, string | number> = {}, status = 400) {
  return Response.json({ error: translate(requestLang(req), key, vars) }, { status })
}

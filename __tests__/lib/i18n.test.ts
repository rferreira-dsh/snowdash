import { describe, expect, it } from "vitest"
import { AppError, DICTS, errorText, requestLang, translate } from "../../lib/i18n/messages"

describe("i18n", () => {
  it("pt and en dictionaries have the same keys", () => {
    expect(Object.keys(DICTS.en).sort()).toEqual(Object.keys(DICTS.pt).sort())
  })

  it("interpolates variables", () => {
    expect(translate("en", "agg.of", { agg: "Sum", name: "PRICE" })).toBe("Sum of PRICE")
    expect(translate("pt", "agg.of", { agg: "Soma", name: "PRECO" })).toBe("Soma de PRECO")
  })

  it("localizes AppError per request language", () => {
    const e = new AppError("e.notDate", { name: "X" })
    expect(errorText(e, "en")).toBe("X is not a date")
    expect(errorText(e, "pt")).toBe("X não é data")
  })

  it("reads language from header, then Accept-Language", () => {
    expect(requestLang(new Request("http://x", { headers: { "x-snowdash-lang": "en" } }))).toBe("en")
    expect(requestLang(new Request("http://x", { headers: { "accept-language": "en-US,en" } }))).toBe("en")
    expect(requestLang(new Request("http://x"))).toBe("pt")
  })
})

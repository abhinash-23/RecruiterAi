import { describe, expect, it } from "vitest"

import {
  auditActionLabel,
  auditPageQuery,
  auditRowId,
  toAuditLogPage,
} from "./audit-log"

describe("auditPageQuery", () => {
  it("sends the filters, search, limit and cursor the backend expects", () => {
    const query = auditPageQuery({
      filters: {
        dateFrom: "2026-11-01",
        dateTo: "2026-11-16",
        actions: ["login", "credits_granted"],
        q: "  vij  ",
      },
      limit: 100,
      cursor: "abc",
    })
    expect(query.get("date_from")).toBe("2026-11-01")
    expect(query.get("date_to")).toBe("2026-11-16")
    // One comma-joined value — the backend ignores a repeated parameter.
    expect(query.getAll("action")).toEqual(["login,credits_granted"])
    expect(query.get("q")).toBe("vij")
    expect(query.get("limit")).toBe("100")
    expect(query.get("cursor")).toBe("abc")
    expect(query.has("tz_offset_minutes")).toBe(true)
  })

  it("leaves out a blank search and the first page's cursor, and caps the limit", () => {
    const query = auditPageQuery({
      filters: { q: "   " },
      limit: 2000,
      cursor: null,
    })
    expect(query.has("q")).toBe(false)
    expect(query.has("cursor")).toBe(false)
    expect(query.get("limit")).toBe("500")
  })
})

describe("toAuditLogPage", () => {
  const entry = {
    id: 412,
    actorEmail: "a@b.com",
    action: "login",
    target: "",
    details: {},
    ipAddress: "1.2.3.4",
    createdAt: "2026-11-12T16:38:00.412345",
  }

  it("reads a paged reply and marks the time as UTC", () => {
    const page = toAuditLogPage({
      status: "ok",
      logs: [entry],
      nextCursor: "next",
      total: 3,
    })
    expect(page).toMatchObject({ paged: true, nextCursor: "next", total: 3 })
    expect(page.logs[0].createdAt).toBe("2026-11-12T16:38:00.412345Z")
  })

  it("treats a null nextCursor as the last page", () => {
    const page = toAuditLogPage({
      status: "ok",
      logs: [entry],
      nextCursor: null,
      total: 1,
    })
    expect(page.nextCursor).toBeNull()
  })

  it("marks a reply from before paging, with the loaded rows as the total", () => {
    const page = toAuditLogPage({ status: "ok", logs: [entry, entry] })
    expect(page).toMatchObject({ paged: false, nextCursor: null, total: 2 })
  })
})

describe("auditRowId and auditActionLabel", () => {
  it("keys rows by id, falling back when the backend sends none", () => {
    const base = {
      actorEmail: "a@b.com",
      action: "login",
      target: "",
      details: {},
      ipAddress: "",
      createdAt: "2026-11-12T16:38:00Z",
    }
    expect(auditRowId({ ...base, id: 7 })).toBe("7")
    expect(auditRowId(base)).toBe("2026-11-12T16:38:00Z-a@b.com-login")
  })

  it("labels the new access actions and humanises the rest", () => {
    expect(auditActionLabel("admin_access_set")).toBe("Access period set")
    expect(auditActionLabel("admin_access_ended")).toBe("Access ended")
    expect(auditActionLabel("company_disabled")).toBe("Company disabled")
  })
})

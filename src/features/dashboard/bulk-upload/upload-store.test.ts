import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError } from "@/services/http-client"
import type { IntakeResult } from "@/services/hr"

const upload = vi.hoisted(() => ({
  fn: vi.fn<(jobId: string, files: File[]) => Promise<IntakeResult>>(),
}))

vi.mock("@/services/hr", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/hr")>()),
  uploadCandidates: upload.fn,
}))

import {
  cancelUpload,
  clearUploadRun,
  duplicateCount,
  failedCount,
  groupFiles,
  problemsCsv,
  retryUpload,
  retryableCount,
  startUpload,
  useUploadRun,
} from "./upload-store"

const MB = 1024 * 1024

const pdf = (name: string, size = 1000) =>
  new File([new Uint8Array(size)], name, { type: "application/pdf" })
const pdfs = (n: number, prefix = "cv") =>
  Array.from({ length: n }, (_, i) => pdf(`${prefix}_${i + 1}.pdf`))

/** Everyone in the request added. */
const allAdded = (files: File[]): IntakeResult => ({
  created: files.map((file) => ({ candidateId: file.name }) as never),
  errors: [],
  queuedForAnalysis: files.length,
  message: "",
})

/** Lets every queued promise and timer settle. */
async function settle() {
  for (let i = 0; i < 20; i += 1) await vi.runAllTimersAsync()
}

// The store notifies React through useSyncExternalStore; read it the same way.
const watch = (jobId: string) => renderHook(() => useUploadRun(jobId))

beforeEach(() => {
  vi.useFakeTimers()
  upload.fn.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("grouping files into requests", () => {
  it("puts at most 20 files in a request", () => {
    expect(groupFiles(pdfs(45)).map((group) => group.length)).toEqual([
      20, 20, 5,
    ])
  })

  it("keeps a request under 25 MB", () => {
    const big = [pdf("a.pdf", 10 * MB), pdf("b.pdf", 10 * MB), pdf("c.pdf", 10 * MB)]
    expect(groupFiles(big).map((group) => group.length)).toEqual([2, 1])
  })
})

describe("uploading", () => {
  it("keeps 3 requests in flight, never more", async () => {
    let inFlight = 0
    let most = 0
    upload.fn.mockImplementation(async (_job, files) => {
      inFlight += 1
      most = Math.max(most, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 100))
      inFlight -= 1
      return allAdded(files)
    })
    const view = watch("j-parallel")
    startUpload("j-parallel", pdfs(200))
    await settle()
    expect(upload.fn).toHaveBeenCalledTimes(10)
    expect(most).toBe(3)
    expect(view.result.current).toMatchObject({
      phase: "done",
      uploaded: 200,
      created: 200,
      inFlight: 0,
    })
  })

  it("adds up every file picked: added + already in job + failed + skipped", async () => {
    upload.fn.mockImplementation(async (_job, files) => ({
      created: files.slice(2).map((f) => ({ candidateId: f.name }) as never),
      errors: [
        { filename: files[0]!.name, code: "duplicate", error: "Already in this job" },
        { filename: files[1]!.name, code: "invalid_email", error: "No email found" },
      ],
      queuedForAnalysis: files.length - 2,
      message: "",
    }))
    const view = watch("j-totals")
    startUpload("j-totals", pdfs(45), [
      { name: "photo.png", error: "Not a PDF, DOCX or TXT file" },
    ])
    await settle()
    const run = view.result.current!
    // 3 requests, 2 refused in each.
    expect(run.created).toBe(39)
    expect(duplicateCount(run)).toBe(3)
    expect(failedCount(run)).toBe(3)
    expect(run.skipped).toHaveLength(1)
    expect(
      run.created + duplicateCount(run) + failedCount(run) + run.skipped.length
    ).toBe(46)
    // invalid_email can be retried; a duplicate can't.
    expect(retryableCount(run)).toBe(3)
  })

  it("retries a failed request once, after 2 seconds", async () => {
    upload.fn
      .mockRejectedValueOnce(new ApiError(503, "Service Unavailable"))
      .mockImplementation(async (_job, files) => allAdded(files))
    const view = watch("j-retry")
    startUpload("j-retry", pdfs(5))
    await vi.advanceTimersByTimeAsync(1999)
    expect(upload.fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(upload.fn).toHaveBeenCalledTimes(2)
    expect(view.result.current).toMatchObject({ created: 5, notSent: [] })
  })

  it("marks a request that fails twice as not sent, and carries on", async () => {
    upload.fn.mockImplementation(async (_job, files) => {
      if (files[0]!.name.startsWith("bad")) {
        throw new ApiError(0, "Could not reach the server.")
      }
      return allAdded(files)
    })
    const view = watch("j-twice")
    startUpload("j-twice", [...pdfs(20, "bad"), ...pdfs(20, "good")])
    await settle()
    const run = view.result.current!
    expect(run.phase).toBe("done")
    expect(run.created).toBe(20)
    expect(run.notSent).toHaveLength(20)
    expect(run.notSent[0]).toMatchObject({ code: "not_sent" })
    expect(run.notSent[0]!.error).toMatch(/^Not sent — try again/)
    // The bad request was tried twice, the good one once.
    expect(upload.fn).toHaveBeenCalledTimes(3)
  })

  it("doesn't retry a 4xx: the server has answered", async () => {
    upload.fn.mockRejectedValue(new ApiError(422, "Job is closed"))
    const view = watch("j-422")
    startUpload("j-422", pdfs(3))
    await settle()
    expect(upload.fn).toHaveBeenCalledTimes(1)
    expect(view.result.current!.notSent).toHaveLength(3)
  })

  it("splits a request the server found too big (413)", async () => {
    upload.fn.mockImplementation(async (_job, files) => {
      if (files.length > 10) throw new ApiError(413, "Payload Too Large")
      return allAdded(files)
    })
    const view = watch("j-413")
    startUpload("j-413", pdfs(20))
    await settle()
    expect(upload.fn.mock.calls.map(([, files]) => files.length)).toEqual([
      20, 10, 10,
    ])
    expect(view.result.current).toMatchObject({ created: 20, notSent: [] })
  })

  it("refuses more than 1,000 files in one upload", () => {
    expect(() => startUpload("j-cap", pdfs(1001))).toThrow(/At most 1,000/)
  })
})

describe("retry and cancel", () => {
  it("retry resends not-sent files and invalid_email ones, not duplicates", async () => {
    let attempt = 0
    upload.fn.mockImplementation(async (_job, files) => {
      attempt += 1
      if (attempt === 1) {
        return {
          created: [],
          errors: [
            { filename: files[0]!.name, code: "invalid_email", error: "No email" },
            { filename: files[1]!.name, code: "duplicate", error: "Already in" },
          ],
          queuedForAnalysis: 0,
          message: "",
        }
      }
      return allAdded(files)
    })
    const view = watch("j-again")
    startUpload("j-again", pdfs(2))
    await settle()
    expect(retryableCount(view.result.current!)).toBe(1)

    retryUpload("j-again")
    await settle()
    const sent = upload.fn.mock.calls[1]![1]
    expect(sent.map((file) => file.name)).toEqual(["cv_1.pdf"])
    const run = view.result.current!
    expect(run.created).toBe(1)
    expect(duplicateCount(run)).toBe(1)
    expect(failedCount(run)).toBe(0)
    expect(run.uploaded).toBe(2)
  })

  it("cancel stops new requests; the unsent files can be retried", async () => {
    upload.fn.mockImplementation(async (_job, files) => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return allAdded(files)
    })
    const view = watch("j-cancel")
    startUpload("j-cancel", pdfs(200))
    cancelUpload("j-cancel")
    await settle()
    const run = view.result.current!
    expect(run.phase).toBe("cancelled")
    // The three already in flight finished; the other seven never went.
    expect(run.created).toBe(60)
    expect(run.notSent).toHaveLength(140)
    expect(retryableCount(run)).toBe(140)
    act(() => clearUploadRun("j-cancel"))
    expect(view.result.current).toBeNull()
  })
})

describe("the report", () => {
  it("is a CSV of file, code and reason", async () => {
    upload.fn.mockResolvedValue({
      created: [],
      errors: [{ filename: 'He said "hi".pdf', code: "save_failed", error: "Storage, down" }],
      queuedForAnalysis: 0,
      message: "",
    })
    const view = watch("j-csv")
    startUpload("j-csv", [pdf('He said "hi".pdf')])
    await settle()
    expect(problemsCsv(view.result.current!).split("\r\n")).toEqual([
      "File,Code,Reason",
      '"He said ""hi"".pdf","save_failed","Storage, down"',
    ])
  })
})

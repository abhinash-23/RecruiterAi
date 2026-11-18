import { afterEach, describe, expect, it, vi } from "vitest"

import {
  fitRecommendationLabel,
  getInterviewReport,
  listInterviews,
} from "./interviews"

function respond(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
  )
}

const row = (fit: Record<string, unknown>) => ({
  interview_id: "i1",
  candidate_name: "Asha",
  candidate_email: "asha@example.com",
  role: "Frontend",
  status: "created",
  session_id: null,
  created_at: 1,
  expiry_at: null,
  link_expiry_hours: 48,
  overall_score: null,
  result: null,
  completed_at: null,
  answered: null,
  has_results: false,
  createdBy: null,
  ...fit,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("resume fit on interviews", () => {
  it("reads an analysed fit off a list row", async () => {
    respond({
      status: "success",
      count: 1,
      interviews: [
        row({
          fit_status: "analyzed",
          fit_score: 82,
          fit_recommendation: "STRONG_FIT",
          fit_analyzer_version: "llm",
        }),
      ],
    })
    const [first] = await listInterviews()
    expect(first!.fit).toEqual({
      status: "analyzed",
      score: 82,
      recommendation: "STRONG_FIT",
      analyzerVersion: "llm",
    })
  })

  it("has no fit when the status is null, absent or unknown", async () => {
    respond({
      status: "success",
      count: 3,
      interviews: [
        row({ fit_status: null }),
        row({}),
        row({ fit_status: "x" }),
      ],
    })
    const rows = await listInterviews()
    expect(rows.map((item) => item.fit)).toEqual([null, null, null])
  })

  it("keeps a pending fit without a score", async () => {
    respond({
      status: "success",
      count: 1,
      interviews: [row({ fit_status: "pending", fit_score: null })],
    })
    const [first] = await listInterviews()
    expect(first!.fit).toMatchObject({ status: "pending", score: null })
  })

  it("reads the fit and its analysis off the report", async () => {
    respond({
      status: "success",
      interview_id: "i1",
      candidate_name: "Asha",
      candidate_email: "asha@example.com",
      role: "Frontend",
      interview_status: "created",
      consent: null,
      created_at: 1,
      link_expiry_hours: 48,
      link_expires_at: null,
      createdBy: null,
      results: null,
      fit_status: "analyzed",
      fit_score: 41,
      fit_recommendation: "PARTIAL_FIT",
      fit_analyzer_version: "keyword_fallback",
      fit_analysis: { summary: "Some React.", strengths: ["React"] },
    })
    const report = await getInterviewReport("i1")
    expect(report.fit).toMatchObject({
      score: 41,
      analyzerVersion: "keyword_fallback",
    })
    expect(report.fitAnalysis).toEqual({
      summary: "Some React.",
      strengths: ["React"],
    })
  })

  it("labels the recommendations in words", () => {
    expect(fitRecommendationLabel("STRONG_FIT")).toBe("Strong fit")
    expect(fitRecommendationLabel("POOR_FIT")).toBe("Poor fit")
    expect(fitRecommendationLabel("NEW VALUE")).toBe("New value")
  })
})

/**
 * ============================================================================
 * THE CANDIDATE SITTING — the interview engine, candidate side
 * ============================================================================
 * Candidates have **no account**. They arrive on a link containing
 * `interview_id`, `email`, `name` and `role`, prove who they are with a 6-digit
 * code, and are issued a *candidate token* bound to exactly one interview.
 *
 * The sequence:
 *
 *   resend-otp? → verify-otp → consent → (answers · vitals · heartbeat) → finish
 *
 * Two things separate this from every other service in the app:
 *
 *  1. **The token is not the staff session token.** It is returned by
 *     `verifyOtp`, lives ~4 hours, is refused on every staff endpoint, and must
 *     be passed explicitly to each call here. It is deliberately *not* stored
 *     in the app's auth session — a candidate is not a user.
 *  2. **`POST /api/verify-otp` is one-shot.** Opening the link in a second tab
 *     answers 409; a completed interview answers 410. Both are terminal.
 */

import { apiFetch } from "@/services/http-client"

/* ========================================================================== */
/*  Types                                                                     */
/* ========================================================================== */

/** How the candidate answers a given question. */
export type QuestionInputMode = "likert" | "mcq" | "text" | "voice" | string

export interface InterviewQuestion {
  questionIndex: number
  round: number
  roundName: string
  type: string
  question: string
  options: string[]
  inputMode: QuestionInputMode
}

export interface RoundSummary {
  name: string
  round: number
  count: number
  types: string[]
}

/** Everything `verifyOtp` hands back — the whole sitting, up front. */
export interface CandidateSession {
  candidateToken: string
  /** Epoch millis. */
  candidateTokenExpiresAt: number
  sessionId: string
  interviewId: string
  candidateName: string
  role: string
  questions: InterviewQuestion[]
  totalQuestions: number
  totalRounds: number
  rounds: RoundSummary[]
  timeMinutes: number
}

export interface AnswerResult {
  questionIndex: number
  score: number | null
  feedback: string | null
}

export interface VoiceAnswerResult extends AnswerResult {
  /** Empty when speech could not be understood — offer a retry. */
  transcription: string
  /** False when the server returned `status: "error"` inside a 200. */
  understood: boolean
}

export interface HeartbeatResult {
  /** False means the server closed the session — stop and show "session ended". */
  active: boolean
  serverTime: number | null
}

export interface VitalsReading {
  faceDetected: boolean
  heartRate: number | null
  raw: Record<string, unknown>
}

/**
 * The vitals summary, as it appears both in `GET /api/vitals/report/{id}` and
 * inside a finished interview's `results.vitals_report`.
 *
 * `heartRate` and `framesProcessed` are always there; the clinical fields only
 * on deployments that enable biomarkers. Every reading named in `estimatedOnly`
 * is **derived rather than optically measured** and must be labelled as such —
 * an unlabelled SpO₂ reading looks like a medical measurement, and it isn't.
 */
export interface VitalsReport {
  heartRate: number | null
  framesProcessed: number
  stressIndex: number | null
  spo2: number | null
  respiratoryRate: number | null
  glucose: number | null
  bloodPressure: { systolic: number | null; diastolic: number | null } | null
  bloodMarkers: Record<string, unknown> | null
  /** Wire keys (`spo2`, `respiratory_rate`, …) the server flags as estimated. */
  estimatedOnly: string[]
  raw: Record<string, unknown>
}

export interface RoundScore {
  name: string
  score: number
  outOf: number
  percentage: number
}

/**
 * The scored report `finish-interview` hands back.
 *
 * Every field is optional on the wire — a sitting that ends before scoring
 * completes returns the envelope with nothing in it — so a null
 * `overallScore` means "no score", never "zero".
 */
export interface InterviewSummary {
  overallScore: number | null
  /** Raw outcome string, e.g. `"SELECTED"` / `"NOT SELECTED"`. */
  result: string | null
  selected: boolean
  answered: number | null
  totalQuestions: number | null
  rounds: RoundScore[]
  raw: Record<string, unknown>
}

/* ========================================================================== */
/*  Wire format                                                               */
/* ========================================================================== */

/**
 * A question as `verify-otp` returns it.
 *
 * ⚠️ The index field is named **`index`** here, while `submit-answer` requires
 * it back as **`question_index`**. (The API docs say `question_index` in both
 * places; only the request half is right. Reading the wrong one sends
 * `question_index: undefined` and every answer 422s.) `question_index` is
 * accepted as a fallback in case a later version adds it.
 */
interface RawQuestion {
  index?: number
  question_index?: number
  round: number
  round_name: string
  type: string
  question: string
  options?: string[]
  input_mode: string
}

interface VerifyEnvelope {
  status: string
  candidate_token: string
  candidate_token_expires_at: number
  session_id: string
  interview_id: string
  candidate_name: string
  role: string
  questions: RawQuestion[]
  total_questions: number
  total_rounds: number
  round_summary?: Record<
    string,
    { round: number; count: number; types: string[] }
  >
  time_minutes: number
}

/** Candidate calls authenticate with the candidate token, not the app session. */
function asCandidate<T>(
  path: string,
  token: string,
  body?: unknown
): Promise<T> {
  return apiFetch<T>(path, { method: "POST", token, body })
}

function toQuestion(raw: RawQuestion, position: number): InterviewQuestion {
  return {
    // `index` is what the server actually sends; fall back to the documented
    // name, then to array position so a missing field can't become `undefined`
    // and silently 422 the submit.
    questionIndex: raw.index ?? raw.question_index ?? position,
    round: raw.round,
    roundName: raw.round_name,
    type: raw.type,
    question: raw.question,
    options: raw.options ?? [],
    inputMode: raw.input_mode,
  }
}

/* ========================================================================== */
/*  Link parsing                                                              */
/* ========================================================================== */

export interface InterviewLinkParams {
  interviewId: string
  email: string
  name: string
  role: string
}

/**
 * Reads the four parameters out of an invitation link.
 *
 * The backend builds links in **hash** form —
 * `https://host/#/otp?interview_id=…&email=…` — while this app routes on real
 * paths, so the query string can be after the `#` or before it depending on how
 * the candidate arrived. Check both rather than assuming.
 */
export function parseInterviewLink(
  href: string = window.location.href
): InterviewLinkParams | null {
  const url = new URL(href, window.location.origin)

  // A hash like "#/otp?interview_id=..." carries its own query string.
  const hashQuery = url.hash.includes("?")
    ? new URLSearchParams(url.hash.slice(url.hash.indexOf("?") + 1))
    : null

  const read = (key: string) =>
    hashQuery?.get(key) ?? url.searchParams.get(key) ?? ""

  const interviewId = read("interview_id")
  if (!interviewId) return null

  return {
    interviewId,
    email: read("email"),
    name: read("name"),
    role: read("role"),
  }
}

/**
 * Rebuilds the invitation link for an interview.
 *
 * `GET /api/interviews` doesn't carry one — a link is only returned once, by
 * the schedule call — so a recruiter who needs to send it by hand later has to
 * have it reconstructed from the row.
 *
 * **Path form, not the hash form the backend emails.** The hash version put
 * every parameter inside the fragment, and a fragment is client-only: hand
 * `https://host/#/otp?interview_id=…` to `POST /api/send-interview` as its
 * `interview_url` and the server parses it, sees no query string at all, and
 * emails a link rebuilt from the fields it *does* have — email, name, role —
 * with no `interview_id`. The candidate then lands on "this link isn't
 * complete". In path form the parameters are in a real query string, where
 * anything that parses the URL can see them.
 *
 * `normaliseHashRoute` still rewrites `#/otp?…` at load, so links the backend
 * generated in the old form keep working.
 */
export function buildInterviewLink(
  input: {
    interviewId: string
    email: string
    name?: string
    role?: string
  },
  origin: string = window.location.origin
): string {
  const query = new URLSearchParams({
    interview_id: input.interviewId,
    email: input.email,
  })
  if (input.name) query.set("name", input.name)
  if (input.role) query.set("role", input.role)

  return `${origin.replace(/\/+$/, "")}/otp?${query}`
}

/* ========================================================================== */
/*  1 · Getting in                                                            */
/* ========================================================================== */

/**
 * Emails a fresh code. The code itself is **never** in the response — only the
 * inbox gets it.
 *
 * 404 = wrong interview/email pair · 429 = more than 3 sends in 10 minutes ·
 * 409/410 = the link is used or expired.
 */
export async function resendOtp(input: {
  interviewId: string
  email: string
}): Promise<{ emailSent: boolean; message: string }> {
  const response = await apiFetch<{
    status: string
    emailSent: boolean
    message: string
  }>("/resend-otp", {
    method: "POST",
    body: { interview_id: input.interviewId, email: input.email },
  })
  return { emailSent: response.emailSent, message: response.message }
}

/**
 * Exchanges the code for a candidate token and the full question set.
 *
 * Errors are all terminal-ish and need distinct copy: 400 wrong code · 429 too
 * many attempts · 409 already started elsewhere · 410 expired or completed ·
 * 403 consent already refused.
 */
export async function verifyOtp(input: {
  interviewId: string
  email: string
  otp: string
}): Promise<CandidateSession> {
  const response = await apiFetch<VerifyEnvelope>("/verify-otp", {
    method: "POST",
    body: {
      interview_id: input.interviewId,
      email: input.email,
      otp: input.otp.trim(),
    },
  })

  const rounds = Object.entries(response.round_summary ?? {}).map(
    ([name, summary]) => ({ name, ...summary })
  )

  return {
    candidateToken: response.candidate_token,
    candidateTokenExpiresAt: Math.round(
      response.candidate_token_expires_at * 1000
    ),
    sessionId: response.session_id,
    interviewId: response.interview_id,
    candidateName: response.candidate_name,
    role: response.role,
    questions: response.questions.map(toQuestion),
    totalQuestions: response.total_questions,
    totalRounds: response.total_rounds,
    rounds: rounds.sort((a, b) => a.round - b.round),
    timeMinutes: response.time_minutes,
  }
}

/**
 * Records consent. **Declining ends the interview permanently** and is reported
 * to the recruiter, so the UI must confirm before sending `false`.
 *
 * Needs the candidate token, which is why the consent screen comes *after* code
 * entry rather than before it.
 */
export async function submitConsent(
  token: string,
  input: {
    interviewId: string
    candidateEmail: string
    consentGiven: boolean
    consentText?: string
  }
): Promise<void> {
  await asCandidate("/consent", token, {
    interview_id: input.interviewId,
    candidate_email: input.candidateEmail,
    consent_given: input.consentGiven,
    ...(input.consentText ? { consent_text: input.consentText } : {}),
  })
}

/* ========================================================================== */
/*  2 · The sitting                                                           */
/* ========================================================================== */

/**
 * Submits one answer. `answer` is the **option index** for MCQ and Likert
 * questions and free text for open ones — sending a string where an index is
 * expected scores zero rather than erroring.
 */
export async function submitAnswer(
  token: string,
  input: { sessionId: string; questionIndex: number; answer: number | string }
): Promise<AnswerResult> {
  const response = await asCandidate<{
    status: string
    question_index: number
    score: number | null
    feedback: string | null
  }>("/submit-answer", token, {
    session_id: input.sessionId,
    question_index: input.questionIndex,
    answer: input.answer,
  })

  return {
    questionIndex: response.question_index,
    score: response.score,
    feedback: response.feedback,
  }
}

/**
 * Transcribes and scores a spoken answer in one call.
 *
 * A failure to understand speech arrives as **HTTP 200** with
 * `status: "error"` and an empty transcription — not an exception. Check
 * `understood` and offer a retry.
 */
export async function submitVoiceAnswer(
  token: string,
  input: {
    sessionId: string
    questionIndex: number
    audioBase64: string
    language?: string
  }
): Promise<VoiceAnswerResult> {
  const response = await asCandidate<{
    status: string
    question_index?: number
    score?: number | null
    feedback?: string | null
    transcription?: string
  }>("/submit-answer-voice", token, {
    session_id: input.sessionId,
    question_index: input.questionIndex,
    audio_base64: input.audioBase64,
    ...(input.language ? { language: input.language } : {}),
  })

  return {
    questionIndex: response.question_index ?? input.questionIndex,
    score: response.score ?? null,
    feedback: response.feedback ?? null,
    transcription: response.transcription ?? "",
    understood: response.status !== "error" && Boolean(response.transcription),
  }
}

/**
 * Transcribes speech **without scoring it**.
 *
 * The separate endpoint exists for exactly the multiple-choice case:
 * `submit-answer-voice` hands the sentence to the scorer as free text, which
 * marks "option A" wrong on a question whose answer is the index `0`. So a
 * spoken choice is transcribed here, mapped to an option, and submitted as an
 * index like any clicked answer.
 *
 * Answers **422** when nothing intelligible was heard — worth catching, since
 * the fix is "say it again", not "something went wrong".
 */
export async function speechToText(
  token: string,
  input: { audioBase64: string; language?: string }
): Promise<string> {
  const response = await asCandidate<{ status?: string; text?: string }>(
    "/speech-to-text",
    token,
    {
      audio_base64: input.audioBase64,
      ...(input.language ? { language: input.language } : {}),
    }
  )
  return response.text?.trim() ?? ""
}

/**
 * Tells the server the candidate is still there. Send about every 30 seconds;
 * `active: false` means the sitting was closed server-side.
 */
export async function heartbeat(
  token: string,
  input: { sessionId: string; interviewId: string }
): Promise<HeartbeatResult> {
  const response = await asCandidate<{
    status: string
    active: boolean
    server_time?: number
  }>("/heartbeat", token, {
    session_id: input.sessionId,
    interview_id: input.interviewId,
  })

  return {
    active: response.active,
    serverTime:
      typeof response.server_time === "number"
        ? Math.round(response.server_time * 1000)
        : null,
  }
}

/** Starts vitals capture. Call once, after the camera is live. */
export async function initVitals(
  token: string,
  input: {
    sessionId: string
    age?: number
    gender?: string
    height?: number
    weight?: number
  }
): Promise<void> {
  await asCandidate("/vitals/init", token, {
    session_id: input.sessionId,
    ...(input.age !== undefined ? { age: input.age } : {}),
    ...(input.gender ? { gender: input.gender } : {}),
    ...(input.height !== undefined ? { height: input.height } : {}),
    ...(input.weight !== undefined ? { weight: input.weight } : {}),
  })
}

/** Sends one sampled webcam frame and gets the live reading back. */
export async function sendVitalsFrame(
  token: string,
  input: { sessionId: string; frameBase64: string; timestampMs?: number }
): Promise<VitalsReading> {
  const raw = await asCandidate<Record<string, unknown>>(
    "/vitals/frame",
    token,
    {
      session_id: input.sessionId,
      frame_base64: input.frameBase64,
      ...(input.timestampMs !== undefined
        ? { timestamp_ms: input.timestampMs }
        : {}),
    }
  )

  return {
    faceDetected: raw.face_detected === true,
    heartRate: typeof raw.heart_rate === "number" ? raw.heart_rate : null,
    raw,
  }
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * Normalises a vitals payload. Returns null when no frames were processed —
 * a report of all-nulls is worse than no panel at all, because it reads as
 * "measured zero" rather than "never measured".
 */
export function toVitalsReport(payload: unknown): VitalsReport | null {
  if (!payload || typeof payload !== "object") return null
  const raw = payload as Record<string, unknown>

  const pressure = raw.blood_pressure
  const estimated = raw.estimated_only

  const report: VitalsReport = {
    heartRate: numberOrNull(raw.heart_rate),
    framesProcessed: numberOrNull(raw.frames_processed) ?? 0,
    stressIndex: numberOrNull(raw.stress_index),
    spo2: numberOrNull(raw.spo2),
    respiratoryRate: numberOrNull(raw.respiratory_rate),
    glucose: numberOrNull(raw.glucose),
    bloodPressure:
      pressure && typeof pressure === "object"
        ? {
            systolic: numberOrNull(
              (pressure as Record<string, unknown>).systolic
            ),
            diastolic: numberOrNull(
              (pressure as Record<string, unknown>).diastolic
            ),
          }
        : null,
    bloodMarkers:
      raw.blood_markers && typeof raw.blood_markers === "object"
        ? (raw.blood_markers as Record<string, unknown>)
        : null,
    estimatedOnly: Array.isArray(estimated)
      ? estimated.filter((key): key is string => typeof key === "string")
      : [],
    raw,
  }

  if (report.framesProcessed === 0 && report.heartRate === null) return null
  return report
}

export async function getVitalsReport(
  token: string,
  sessionId: string
): Promise<VitalsReport | null> {
  const raw = await apiFetch<Record<string, unknown>>(
    `/vitals/report/${encodeURIComponent(sessionId)}`,
    { token }
  )
  return toVitalsReport(raw)
}

/* ========================================================================== */
/*  Recording the sitting                                                     */
/* ========================================================================== */

export interface RecordingUploadSession {
  recordingSessionId: string
  /**
   * A Google resumable-upload URI. Chunks are `PUT` **straight to it** — the
   * bytes never pass through our API, which is the whole point: an interview
   * is far too large to relay.
   */
  uploadSessionUri: string
  /** How much to buffer before each PUT. ~8 MB unless the server says else. */
  uploadBufferHintBytes: number
}

/** Opens an upload session for one interview's video. */
export async function startRecordingUpload(
  token: string,
  interviewId: string,
  input: { fileName?: string; contentType?: string; candidateId?: string } = {}
): Promise<RecordingUploadSession | null> {
  const response = await asCandidate<{
    status?: string
    recordingSessionId?: string
    uploadSessionUri?: string
    uploadBufferHintBytes?: number
  }>(`/recordings/start-upload/${encodeURIComponent(interviewId)}`, token, {
    contentType: input.contentType ?? "video/webm",
    fileName: input.fileName ?? "",
    ...(input.candidateId ? { candidateId: input.candidateId } : {}),
  })

  if (!response.recordingSessionId || !response.uploadSessionUri) return null

  return {
    recordingSessionId: response.recordingSessionId,
    uploadSessionUri: response.uploadSessionUri,
    uploadBufferHintBytes: response.uploadBufferHintBytes || 8 * 1024 * 1024,
  }
}

/** Tells our API how far the direct-to-storage upload has got. */
export async function reportUploadProgress(
  token: string,
  recordingSessionId: string,
  input: { uploadedBytes: number; totalBytes?: number; status?: string }
): Promise<void> {
  await asCandidate(
    `/recordings/upload-progress/${encodeURIComponent(recordingSessionId)}`,
    token,
    {
      uploadedBytes: input.uploadedBytes,
      ...(input.totalBytes !== undefined ? { totalBytes: input.totalBytes } : {}),
      ...(input.status ? { status: input.status } : {}),
    }
  )
}

export async function finalizeRecording(
  token: string,
  recordingSessionId: string
): Promise<void> {
  await asCandidate(
    `/recordings/finalize/${encodeURIComponent(recordingSessionId)}`,
    token,
    {}
  )
}

export async function cancelRecording(
  token: string,
  recordingSessionId: string
): Promise<void> {
  await asCandidate(
    `/recordings/cancel/${encodeURIComponent(recordingSessionId)}`,
    token,
    {}
  )
}

/**
 * Attaches a finished recording to its interview, so the recruiter's report can
 * find it. Without this the video exists in storage but nothing points at it.
 */
export async function linkRecording(
  token: string,
  interviewId: string,
  input: { recordingSessionId?: string; videoPath?: string }
): Promise<void> {
  await asCandidate(
    `/link-recording/${encodeURIComponent(interviewId)}`,
    token,
    {
      ...(input.recordingSessionId
        ? { recordingSessionId: input.recordingSessionId }
        : {}),
      ...(input.videoPath ? { videoPath: input.videoPath } : {}),
    }
  )
}

/* ========================================================================== */
/*  3 · Leaving                                                               */
/* ========================================================================== */

/**
 * Marks the sitting abandoned when the tab goes away.
 *
 * Uses `sendBeacon` because a normal fetch is cancelled during unload. Beacons
 * cannot set headers, which is why this endpoint needs no auth — the session id
 * is the credential.
 */
export function reportInterviewClosed(input: {
  sessionId: string
  interviewId: string
  reason: string
}): boolean {
  const url = `${import.meta.env.VITE_API_BASE_URL ?? "/api"}/interview-closed`.replace(
    /([^:]\/)\/+/g,
    "$1"
  )

  const payload = JSON.stringify({
    session_id: input.sessionId,
    interview_id: input.interviewId,
    reason: input.reason,
  })

  try {
    return navigator.sendBeacon(
      url,
      new Blob([payload], { type: "application/json" })
    )
  } catch {
    return false
  }
}

/* ========================================================================== */
/*  Reading the final report                                                  */
/* ========================================================================== */

/** `"NOT SELECTED"` (server) and `"NOT_SELECTED"` (docs) must both fail this. */
function isSelected(result: string | null): boolean {
  if (!result) return false
  return result.trim().replace(/[\s_]+/g, "_").toUpperCase() === "SELECTED"
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/**
 * Normalises a scored report into {@link InterviewSummary}.
 *
 * The scores sit under a `results` key on `get-results`, but arrive at the top
 * level of the `finish-interview` body — so unwrap `results` when it's there
 * and read the payload itself when it isn't, rather than betting on one shape.
 *
 * Exported so a caller that already holds a raw report (a retry through
 * `GET /api/get-results/{interview_id}`, say) can reuse the same reading of it.
 */
export function toInterviewSummary(
  payload: Record<string, unknown> | null | undefined
): InterviewSummary | null {
  if (!payload) return null

  const nested = payload.results
  const body: Record<string, unknown> =
    nested && typeof nested === "object"
      ? (nested as Record<string, unknown>)
      : payload

  const result = typeof body.result === "string" ? body.result : null

  const breakdown =
    body.round_breakdown && typeof body.round_breakdown === "object"
      ? (body.round_breakdown as Record<string, Record<string, unknown>>)
      : {}

  const rounds = Object.entries(breakdown).map(([name, entry]) => ({
    name,
    score: asNumber(entry?.score) ?? 0,
    outOf: asNumber(entry?.out_of) ?? 0,
    percentage: asNumber(entry?.percentage) ?? 0,
  }))

  const summary: InterviewSummary = {
    overallScore: asNumber(body.overall_score) ?? asNumber(body.overall_score_pct),
    result,
    selected: isSelected(result),
    answered: asNumber(body.answered),
    totalQuestions: asNumber(body.total_questions),
    rounds,
    raw: payload,
  }

  // Nothing worth showing — an empty envelope shouldn't render as a 0% score.
  if (summary.overallScore === null && rounds.length === 0) return null
  return summary
}

/**
 * Ends the interview and returns the scored report immediately.
 *
 * The link dies here — re-verifying afterwards answers 410, so this is the only
 * chance to show the candidate their own result. Returns null when the server
 * closed the sitting without scoring it; the caller shows a plain
 * acknowledgement in that case rather than an empty scorecard.
 */
export async function finishInterview(
  token: string,
  sessionId: string
): Promise<InterviewSummary | null> {
  const response = await asCandidate<Record<string, unknown>>(
    "/finish-interview",
    token,
    { session_id: sessionId }
  )
  return toInterviewSummary(response)
}

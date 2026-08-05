# CognitiveScreen AI — Backend API Documentation

**Audience:** the frontend team building the three consoles and the candidate interview page.
**API version:** v3.5-PG (84 REST + 1 WebSocket) · **Doc date:** 2026-08-04
**Interactive reference:** `GET /docs` (Swagger UI) on any running instance — always current, grouped the same way as this document.

> **Changed since 2026-07-31:**
> - **Live viewing (NEW):** `WS /api/live/{interview_id}` — HR/admin watch a candidate live over peer-to-peer WebRTC (free STUN, best-effort). Backend is signaling-only; see §9.6 for the full contract.
> - **Admin drill-down:** `GET /api/company/hrs` rows carry `jobCount`/`candidateCount`; `GET /api/hr/jobs` takes `?createdBy=<userId>` (admin-only effect); jobs & candidates on read endpoints carry a `creator {userId, fullName, email}` object. See §7 & §8.1.
> - **Branding everywhere:** `GET /api/company/branding` now answers HR tokens too (dashboards); the public `/api/branding` + `/api/branding/logo` accept `?interview=<interview_id>` so the candidate page white-labels from the invitation link alone. See §5 & §7.

---

## 1. What this platform is

A multi-tenant, white-label recruitment platform around an AI interview engine.

**Four actors, one hierarchy:**

```
Super Admin  (platform owner - exactly ONE account, ever)
    │  creates
  Admin      (one per client; the admin account IS the client)
    │  creates
   HR        (recruiters inside that client)
    │  invites
 Candidate   (NO account - email link + one-time code)
```

Rules that shape every screen you build:

- **One login page for everyone.** The role in the login response decides which console to render. The server re-checks permissions on every request — console routing is cosmetic, security is not your job.
- **One creation door per tier.** Super admin creates admins (`POST /api/platform/admins`). Admins create HRs (`POST /api/company/hrs`). There is **no generic "create user" endpoint** — don't look for one.
- **Admin can do everything HR can**, plus manage the client. Every `/api/hr/*` endpoint accepts an admin token and shows client-wide data.
- **HR sees only what they created.** Jobs, candidates, interviews — a colleague's items don't appear in lists and read as **404** by direct URL. Never filter by user id client-side; the server already did it from the token.
- **Candidates never log in.** They receive a link + 6-digit code by email; a correct code mints a short-lived token bound to exactly one interview.

---

## 2. Getting started

### Base URL

| Environment | Base URL |
|---|---|
| Shared dev tunnel | the `https://….ngrok-free.app` URL you were given (changes when the tunnel restarts) |
| Local (if you run the backend yourself) | `http://127.0.0.1:8080` |
| Production | Cloud Run URL (TBD) |

### ngrok quirk (dev tunnel only) — read this first

The free ngrok tier intercepts browser requests with a warning page **unless** every request carries this header:

```
ngrok-skip-browser-warning: true
```

Add it to your HTTP client's default headers or your first JSON call will come back as HTML.

### Test-data rules on the shared dev instance

- **All emails you type must end in `@example.com`** — the backend sends real emails (invitations, temporary passwords) from a real account. `@example.com` is IANA-reserved and bounces harmlessly.
- The AI proxy is now reachable from the dev machine, so resume analysis normally returns `analyzer_version: "llm"` and rounds 3/4 generate real questions. If the proxy is down you'll see the keyword fallback (`analyzer_version: "keyword_fallback"`, ~20 s in the background) instead — both shapes are valid and your UI must handle either. Prefer `"rounds": ["psychometrics"]` when you just need a fast interview to click through.

---

## 3. Authentication

Four credential types. As a frontend you will use the first two.

| Credential | Header | Who | Lifetime |
|---|---|---|---|
| **User token** | `Authorization: Bearer <token>` | super admin / admin / HR after login | 12 h or logout |
| **Candidate token** | `Authorization: Bearer <token>` | a candidate after OTP verification | ~4 h, one interview only |
| Machine key (`csk_…`) | `X-API-Key` | a client's own backend (not the frontend) | until revoked |
| `X-Admin-Key` | `X-Admin-Key` | Cloud Scheduler cron jobs only | static |

The retired legacy shared key (`ds-…`) **does not exist** — if you find it in old examples, delete it; it returns 401.

### 3.1 Login — `POST /api/auth/login` (public)

```json
{ "email": "admin@client.com", "password": "TheirPassword!1" }
```

**200:**
```json
{
  "status": "ok",
  "token": "eyJ…",
  "expires_at": 1783948800.0,
  "user": {
    "userId": "6ad9…",
    "email": "admin@client.com",
    "fullName": "Priya Sharma",
    "role": "admin",
    "phone": "",
    "companyName": "Acme Corp",
    "mustChangePassword": false
  }
}
```

- `user.role` ∈ `super_admin | admin | hr` → picks the console.
- **401 `"Invalid email or password"`** — wrong email *or* wrong password (indistinguishable by design; also what a disabled account returns to a *wrong* password, so account existence never leaks).
- **403 `"Your account has been disabled. Contact your administrator."`** — the password was correct but the account is disabled. Show this verbatim (a distinct "account suspended" screen), not the generic 401.

### 3.2 Forced first-login password change — not optional

Accounts are born with an emailed **temporary password** and `mustChangePassword: true`. While that flag is true, **every endpoint returns 403** except:

- `GET /api/auth/me`
- `POST /api/auth/change-password` — body `{ "current_password": "…", "new_password": "…" }` (new: 8–128 chars)
- `POST /api/auth/logout`

**Required flow:** login → if `mustChangePassword` → render only the "set new password" screen → change-password (token stays valid) → continue to the console. Same component works for admins and HRs.

### 3.3 Session behavior

- Send the token on every call: `Authorization: Bearer <token>`.
- `GET /api/auth/me` → `{status, user:{…, permissions:[…]}}` — cheap "who am I" for app boot.
- `POST /api/auth/logout` revokes the token server-side immediately.
- A password reset by a superior **revokes all sessions** of that user — expect 401s and route to login.
- On any 401 → discard the token, go to login.

### 3.4 Candidate token

Returned by `POST /api/verify-otp` (§9). Bearer format, but: bound to exactly one interview + session; refused with 401 on every staff endpoint; foreign ids read 404. Store it for the duration of the sitting only.

---

## 4. Conventions (apply everywhere)

**Response envelope.** Success responses carry `"status": "ok"` plus payload fields at the top level (no `data` wrapper). The legacy interview list also carries `"success": true` — ignore it.

**Errors** are FastAPI-shaped: `{"detail": "human-readable message"}`. The messages are written for end users — showing `detail` verbatim in a toast is acceptable UX.

| Code | Meaning | Frontend reaction |
|---|---|---|
| 400 | Bad input (wrong OTP, bad index) | show `detail` |
| 401 | No/invalid/expired credential | go to login (or code-entry for candidates) |
| 403 | Authenticated but not allowed — includes `mustChangePassword` pending and disabled-client writes | show `detail`; check for password-rotation case |
| 404 | Doesn't exist **or exists outside your scope** — indistinguishable by design | show "not found" |
| 409 | Conflict (duplicate email/name, interview already started, already scheduled) | show `detail` |
| 410 | Gone (link expired, interview already completed) | show `detail`, terminal state |
| 422 | Validation failure (Pydantic list in `detail`, or plain message) | highlight fields / show message |
| 429 | Throttled (OTP guessing, resend limit) | show "wait a few minutes" |

**IDs.** All opaque strings. `adminId` (client/tenant id), `userId`, `jobId`, `candidateId` (UUIDs); `interviewId` (12-char); `session_id` (16-char, candidate sitting). You only ever *carry* ids between screens — never send a user id to filter data.

**Timestamps — two formats, historical reasons.** Staff-domain objects (admins, HRs, jobs, candidates) use ISO-8601 strings (`"2026-07-31T09:15:22.123456"`). The interview engine uses Unix epoch floats (`created_at`, `expiry_at`, `expires_at`) *plus* pre-formatted ISO strings where you need them (`link_expires_at`, `completed_at`). When in doubt: number = epoch seconds, string = ISO.

**Batch endpoints never all-or-nothing.** Candidate intake, file upload, scheduling all return `created`/`scheduled` **and** per-item `errors` in one 200. Always render both.

**One-time secrets.** Temporary passwords and machine keys appear in exactly one response, never again. Any screen showing one needs copy-to-clipboard + "this will not be shown again."

**The API only ever adds response fields**, never removes or renames — code tolerantly (ignore unknown fields).

**URL building:** never let a path id be empty (`/api/hr/jobs//candidates` triggers a redirect that **drops the Authorization header** → misleading 401). Guard your route params.

---

## 5. The login page & white-labeling (public, no token)

Each client gets your platform in their branding, loaded **before** login via their slug:

`GET /api/branding?company=<slug>` →
```json
{
  "status": "ok",
  "branding": {
    "appName": "Acme Hiring",
    "logoUrl": "/api/branding/logo?company=acme",
    "primaryColor": "#123456",
    "accentColor": "#818cf8",
    "companyName": "Acme Corp",
    "supportEmail": "hiring@acme.com"
  }
}
```

- Unknown or missing slug → platform default branding (never an error) — a stale bookmark still renders a usable page.
- `GET /api/branding/logo?company=<slug>` serves the logo file itself (404 if none configured — hide the `<img>`).
- **Candidate pages:** both endpoints also accept `?interview=<interview_id>` — the id from the invitation link resolves the owning client's branding, so the OTP screen, consent screen and the whole sitting render white-labeled with no token and no slug. Unknown/legacy ids fall back to platform branding, same as slugs.
- **Staff dashboards (HR included):** don't use these public endpoints post-login — call `GET /api/company/branding` with the bearer token (see §7); it answers any of the client's staff, admin and HR alike.
- `GET /api/health` → liveness probe, includes `version`.

---

## 6. Super Admin console (`role: "super_admin"`)

The platform owner's console: manages **admins** (one per client), their machine keys, roles, global settings, aggregate analytics, audit. **Structurally excluded from candidate data** — never build interview/job/candidate views here; the API answers 403 regardless of permissions.

### 6.1 The admin object (returned by all admin endpoints)

```json
{
  "adminId": "5ae1…",            ← use this in every /admins/{admin_id} path
  "companyId": "5ae1…",           ← same value, legacy name
  "name": "Acme Corp",
  "slug": "acme",
  "supportEmail": "hiring@acme.com",
  "isActive": true,
  "tenancyEnforced": true,
  "createdBy": "…", "createdAt": "…", "updatedAt": "…",
  "adminUserId": "6ad9…",
  "email": "admin@acme.com",       ← the admin's login
  "fullName": "Priya Sharma",
  "mustChangePassword": false,
  "lastLogin": "2026-07-31T08:00:00",
  "hrCount": 4                     ← the ONLY HR fact visible at this tier
}
```

### 6.2 Endpoints

**`POST /api/platform/admins` — Create Admin.** Body:

| Field | Required | Notes |
|---|---|---|
| `name` | ✅ | client display name |
| `admin_email` | ✅ | becomes the login |
| `slug` | — | auto-generated from name if omitted |
| `support_email`, `admin_full_name`, `admin_phone` | — | optional |

**200:** `{status, admin:{…hrCount:0}, temporaryPassword, credentialsEmailSent, message}` — show `temporaryPassword` once with copy button. **409** duplicate name/slug/email, **422** invalid email.

**`GET /api/platform/admins`** — `{status, count, admins:[…]}`. Query: `is_active=true|false`, `limit` (≤500). This is the tenant directory — render `hrCount` per row.

**`GET /api/platform/admins/{admin_id}`** — one admin. 404 unknown.

**`PATCH /api/platform/admins/{admin_id}`** — body `{name?, support_email?}` → updated admin.

**`POST /api/platform/admins/{admin_id}/reset-password`** — body `{new_password, must_change_password: true}` → `{status, credentialsEmailSent, message}`. Revokes their sessions; with `must_change_password: true` the new password is emailed and single-use. The locked-out-admin support button.

**`POST /api/platform/admins/{admin_id}/disable`** / **`…/enable`** — the lifecycle switch. Disable = the whole client goes **read-only**: logins and reads keep working, every write/interview-creation/machine-key call refuses. Show a "client suspended" state, not a login failure.

**`POST /api/platform/admins/{admin_id}/tenancy`** — body `{enforced: true|false}`. The data-isolation switch. **Flip it ON immediately after creating every admin** (make it part of your create-admin flow).

**Machine keys** (client's server-to-server access):
- `POST /api/platform/admins/{admin_id}/credentials` — body `{label}` → `{status, credential:{credentialId, label, isActive, createdAt, lastUsedAt, revokedAt}, apiKey:"csk_…", message}`. `apiKey` shown **once**.
- `GET …/credentials` — metadata list (never the secret).
- `POST …/credentials/{credential_id}/revoke` — instant.

**`GET /api/platform/analytics`** — aggregates only: per-client interview volumes, completion/abandonment percentages, user counts by role. There is deliberately no drill-down to individual interviews.

**Roles:** `GET /api/platform/roles` (list with `permissions`, `isSystem`), `POST /api/platform/roles` (upsert a **custom** role; `400` when touching `admin`/`hr`/`super_admin`).

**`GET /api/platform/audit-logs?limit=`** — `{status, logs:[{actorEmail, action, target, details, ipAddress, createdAt}]}` newest first.

**Global settings/branding** (platform defaults, not per-client): `GET /api/settings`, `PUT /api/settings/{key}`, `PATCH /api/settings/branding`, `POST /api/settings/logo` (multipart `logo`, ≤3 MB, png/jpg/webp/svg/gif), `DELETE /api/settings/logo`.

---

## 7. Admin console (`role: "admin"`)

The client's own console. **No client id in any URL** — scope comes from the token. Everything below **plus the entire HR section (§8)** with client-wide visibility.

**Profile:** `GET /api/company/profile` → `{status, company:{…}}` · `PATCH /api/company/profile` body `{name?, support_email?}`.

**Branding (their white-label):**
- `GET /api/company/branding` → `{status, branding:{appName, logoUrl, primaryColor, accentColor, …}}` — readable by **any** of the client's staff (admin *and* HR), so every dashboard renders the client's look from the same call. Writes below stay admin-only.
- `PATCH /api/company/branding` — body `{app_name?, primary_color?, accent_color?}` (hex `#rrggbb`, 422 otherwise)
- `POST /api/company/branding/logo` (multipart `logo`) / `DELETE …/logo`
- Changes are immediately visible on the public `GET /api/branding?company=<slug>`.

**Interview defaults** (used whenever an HR schedules without overriding):
- `GET /api/company/interview-defaults` → `{status, defaults:{rounds, time_minutes, link_expiry_hours}}`
- `PATCH` same fields; rounds from: `aptitude`, `psychometrics`, `softskills`, `resume`, `jd` (422 on unknown values).

**Dashboard:** `GET /api/company/dashboard` — counts for the landing page (HRs, jobs, candidates, interviews by status).

**Audit:** `GET /api/company/audit-logs?limit=` — this client's actions only, same row shape as the platform log.

**HR management** (the HR object: `{userId, email, fullName, phone, isActive, mustChangePassword, lastLogin, createdAt}` — list rows add `jobCount` and `candidateCount`):

| Endpoint | Notes |
|---|---|
| `POST /api/company/hrs` | body `{email✅, full_name?, phone?}` → `{status, hr, temporaryPassword, credentialsEmailSent, message}` — one-time password, same UX as create-admin. 409 duplicate email. |
| `GET /api/company/hrs` | `{status, count, hrs:[…]}` — each row also carries `jobCount` and `candidateCount` (this HR's funnel totals), so this list is the entry screen for the admin drill-down below |
| `GET /api/company/hrs/{user_id}` | 404 if not this client's HR |
| `PATCH /api/company/hrs/{user_id}` | `{full_name?, phone?}` — deliberately nothing else |
| `POST …/reset-password` | `{new_password, must_change_password}` — same semantics as the platform's admin reset |
| `POST …/disable` / `…/enable` | disabled HR cannot log in (401) |

**Disabled-client mode:** if the super admin disabled this client, all reads still answer but every write returns **403 "This company is disabled and read-only."** — catch that specific 403 and show a suspended banner.

---

## 8. HR console (`role: "hr"` — and `admin` sees client-wide)

The funnel: **job → candidates in → auto-analysis → ranked shortlist → schedule → results.**

### 8.1 Jobs

Job object: `{jobId, title, role, jobDescription, status: "open"|"closed", createdBy, createdAt, updatedAt}`. On **read** endpoints (list/detail/shortlist/candidate detail) rows additionally carry `creator: {userId, fullName, email} | null` — who made the row, same shape as on interviews. (`createdBy` stays the bare UUID it always was.)

- `POST /api/hr/jobs` — `{title✅ (2–255), job_description✅ (≥30 chars, ≤20000), role?}` (role defaults to the title; it's what the candidate sees) → `{status, job}`
- `GET /api/hr/jobs?status=&limit=&createdBy=` — own jobs (HR) / all client jobs (admin). `createdBy=<userId>` is the **admin's** per-HR filter: it narrows the client-wide view to one recruiter's jobs (unknown/foreign/malformed ids read as an empty list). For an HR caller the parameter is ignored — scope is always themselves.

**Admin drill-down recipe:** `GET /api/company/hrs` (pick an HR, rows carry `jobCount`/`candidateCount`) → `GET /api/hr/jobs?createdBy=<userId>` (their jobs) → `GET /api/hr/jobs/{job_id}/candidates` (that job's shortlist). Every row names its `creator`, so nothing needs client-side UUID matching.
- `GET /api/hr/jobs/{job_id}` — `{status, job, candidates:{total, pending, analyzed, failed}}` ← funnel counts for the job header
- `PATCH /api/hr/jobs/{job_id}` — `{title?, role?, job_description?, status?}` — set `status:"closed"` to stop intake (409 on adding candidates to a closed job)

### 8.2 Candidates in

Candidate object (shortlist row): `{candidateId, jobId, name, email, phone, analysisStatus: "pending"|"analyzed"|"failed", fitScore: 0-100|null, analyzerVersion: "llm"|"keyword_fallback"|null, recommendation, interviewId|null, sourceFilename, createdAt}` — plus `creator {userId, fullName, email}` on the shortlist and detail reads.

**Typed/JSON intake — `POST /api/hr/jobs/{job_id}/candidates`:**
```json
{ "candidates": [ { "email": "a@example.com", "name": "A", "phone": "", "resume_text": "≥30 chars…" } ] }
```
1–50 per call. **200:** `{status, created:[candidate…], errors:[{index, email, error}], queuedForAnalysis, message}` — bad rows never sink the batch. Duplicate application (same email, same job) is a per-item error.

**File upload — `POST /api/hr/jobs/{job_id}/candidates/upload`** (multipart): repeat `files` field, ≤20 files, PDF/DOCX/TXT, ≤10 MB each. Identity is extracted from the documents (first email found in the text; name from filename). For a **single** file only, form fields `email`/`name`/`phone` override. **200:** `{status, created:[…], errors:[{filename, error}], queuedForAnalysis, message}`.

**Analysis is automatic.** Poll the shortlist (a few seconds interval is fine); rows move `pending → analyzed|failed`. `POST /api/hr/candidates/{candidate_id}/reanalyze` re-queues one (the retry button for `failed`, or after editing the JD).

### 8.3 Shortlist & detail

- `GET /api/hr/jobs/{job_id}/candidates` — **already ranked** best-first: `{status, count, mixedAnalyzerVersions, candidates:[…]}`. If `mixedAnalyzerVersions: true`, show a warning — LLM scores and keyword-fallback scores are different scales; don't present them as directly comparable.
- `GET /api/hr/candidates/{candidate_id}` — `{status, candidate:{…, resumeText}, analysis:{…full analyzer output…}}` for the detail drawer.

### 8.4 Schedule — `POST /api/hr/jobs/{job_id}/schedule`

```json
{ "candidate_ids": ["…", "…"], "time_minutes": 30, "link_expiry_hours": 48 }
```
1–20 ids; the knobs are optional (fall back to the client's interview defaults). **There is no calendar** — the candidate gets a validity window and sits whenever they want inside it. That's by design; don't build slot pickers.

**200:**
```json
{
  "status": "ok",
  "scheduled": [
    { "candidateId": "…", "interviewId": "ab12cd34-e56",
      "interviewLink": "https://…/#/otp?interview_id=…", "otpCode": "123456",
      "emailSent": true }
  ],
  "errors": [ { "candidateId": "…", "error": "Already scheduled (interview …)." } ],
  "message": "1 interview(s) scheduled; 1 rejected."
}
```
The invitation (link + code) is emailed automatically. If `emailSent: false`, surface the link + code so the recruiter can send them manually. After scheduling, the candidate row carries `interviewId`.

### 8.5 Interviews & results

- `GET /api/interviews?status=&limit=` — the dashboard list. Row: `{interview_id, candidate_name, candidate_email, role, status, session_id, created_at (epoch), expiry_at (epoch), link_expiry_hours, overall_score, result, completed_at, answered, has_results, createdBy}`. `createdBy` = `{userId, fullName, email}` of the HR who scheduled it, or `null` for machine/legacy rows — render a "Scheduled by" column in the admin's view; skip it in the HR's own view.
- `GET /api/get-results/{interview_id}` — full report: `{status, interview_id, candidate_name, candidate_email, role, interview_status, consent, created_at, link_expiry_hours, link_expires_at, createdBy, results}`. `results` (null until finished) contains `overall_score` (0–100), `result: "SELECTED"|"NOT_SELECTED"`, `round_breakdown` (per-round score/out_of/percentage), `question_details[]` (question, answer, score, feedback), `vitals_report`, `answered`, `total_questions`, `completed_at`.
  - `vitals_report` (null if no webcam frames were processed): always `{heart_rate, frames_processed, stress_index, estimated_only}`; when the deployment enables clinical biomarkers (this one does) it additionally carries `blood_pressure {systolic, diastolic}`, `glucose`, `spo2`, `respiratory_rate`, `blood_markers {…}`. **Render every field listed in `estimated_only` with an "estimated" label** — those values (`spo2`, `respiratory_rate`, `stress_index`) are derived/estimated, not optically measured.
- `POST /api/analyze-resume` — `{resume_text✅, job_description✅ (≤8000 each), role?}` → the standalone analyzer (same engine as the pipeline): `{fit_score, recommendation, analyzer_version, …}`. Can take ~20 s on fallback.
- Status lifecycle of an interview: `created → consent_given → in_progress → completed` — or `expired` / `abandoned` / `superseded` / `consent_refused`.

Interview creation directly (`POST /api/create-interview`) also exists — the scheduler calls the same logic; frontend normally never calls it (it's the machine-integration path).

---

## 9. The candidate interview page (no login)

The candidate opens `interviewLink` (contains `interview_id`, `email`, `name`, `role` as query params). Sequence:

### 9.1 Get a working code

The emailed code lives 10–20 minutes. If it's stale, the page offers **"Send me a fresh code"**:

`POST /api/resend-otp` (public) — `{ "interview_id": "…", "email": "…" }` (both from the link's query params).
**200:** `{status, emailSent, message}` — the code goes **only to the inbox**, never the response. **404** wrong pair · **429** >3 sends per 10 min ("wait a few minutes") · **410/409** link expired / already used.

### 9.2 Verify — `POST /api/verify-otp` (public)

```json
{ "email": "…", "otp": "123456", "interview_id": "…" }
```
**200:**
```json
{
  "status": "ok",
  "candidate_token": "eyJ…", "candidate_token_expires_at": 1783960000.0,
  "session_id": "a1b2c3d4e5f6g7h8", "interview_id": "…",
  "candidate_name": "…", "role": "…",
  "questions": [ { "question_index": 0, "round": 1, "round_name": "Psychometrics",
                   "type": "psychometrics", "question": "…", "options": ["…"],
                   "input_mode": "likert" } ],
  "total_questions": 10, "total_rounds": 1,
  "round_summary": { "Psychometrics": { "round": 1, "count": 10, "types": ["…"] } },
  "time_minutes": 20
}
```
Store `candidate_token` + `session_id`; send the token as `Authorization: Bearer` on everything below. **Errors:** 400 wrong code · 429 too many wrong tries · 409 already started in another tab (one sitting per link, enforced atomically) · 410 expired/completed · 403 consent refused.

### 9.3 Consent — `POST /api/consent` (candidate token)

`{interview_id, candidate_email, consent_given: true|false, consent_text?}` → declining ends the interview permanently (recorded + reported to the recruiter). Note: consent requires the candidate token, so the consent screen comes **after** code entry.

### 9.4 The sitting (all with the candidate token, all keyed on `session_id`)

| Call | Body → Response |
|---|---|
| `POST /api/submit-answer` | `{session_id, question_index, answer}` (int index for MCQ/likert, string for open) → `{status, question_index, score, feedback}` |
| `POST /api/submit-answer-voice` | `{session_id, question_index, audio_base64, language?}` → transcribes + scores in one call; `{status:"error", transcription:""}` (HTTP 200) when speech wasn't understood — offer retry |
| `POST /api/speech-to-text` / `…/upload` | transcription only: `{status, text, language, duration_seconds}` (422 if unintelligible) |
| `POST /api/heartbeat` (every ~30 s) | `{session_id, interview_id}` → `{status, active, server_time}`; `active: false` = session closed server-side → stop and show "session ended" |
| `POST /api/vitals/init` once camera is on | `{session_id, age?, gender?, height?, weight?}` |
| `POST /api/vitals/frame` (sampled webcam frames) | `{session_id, frame_base64, timestamp_ms?}` → live readings incl. `face_detected` |
| `GET /api/vitals/report/{session_id}` | summary: `{heart_rate, frames_processed, …}` (clinical fields only if the deployment enables them) |
| `POST /api/interview-closed` via `navigator.sendBeacon` on pagehide | `{session_id, interview_id, reason}` — no auth header needed (beacons can't set one); marks abandonment |

**Video recording** (browser → cloud storage directly; only when the deployment has storage configured):
1. `POST /api/recordings/start-upload/{interview_id}` — `{fileName?, contentType?, totalBytes?, candidateId?}` → `{recordingSessionId, uploadSessionUri, uploadBufferHintBytes, …}`
2. Upload chunks with `PUT` **directly to `uploadSessionUri`** (Google resumable protocol; ~8 MB buffers per the hint)
3. Report `POST /api/recordings/upload-progress/{recordingSessionId}` `{uploadedBytes}`; on interruption resume via `GET /api/recordings/upload-state/{recordingSessionId}`
4. `POST /api/recordings/finalize/{recordingSessionId}` when done (or `…/cancel`)
5. Staff side: `GET /api/recordings/{recordingSessionId}/playback-url` returns a time-limited playback URL.

### 9.5 Finish — `POST /api/finish-interview`

`{session_id}` → returns the **full result payload immediately** (same shape as `results` in §8.5). Show the candidate a "thank you" (whether you show scores is a product decision). The link is dead afterwards — re-verifying answers 410.

### 9.6 Live viewing — HR/admin watches the interview live (WebRTC)

An HR (own interviews) or admin (company-wide) can watch a candidate **live**, video + audio, over WebRTC. The media is **peer-to-peer, browser-to-browser** — it never touches the backend. The backend provides only a **signaling** channel (a WebSocket) that relays the WebRTC handshake, plus a free public STUN server on the client side. No TURN and no media server, so it's **best-effort**: on restrictive networks (some corporate/NAT setups) the direct connection can't form — fall back to the recording (§9.4).

**Endpoint:** `WS /api/live/{interview_id}` — both the candidate (publisher) and each viewer (HR/admin) connect here.

**1. Authenticate as the first message** (never in the URL):
```
candidate → {type:"auth", role:"candidate", token:"<candidate_token from verify-otp>"}
viewer    → {type:"auth", role:"viewer",    token:"<staff bearer token>"}
```
Server replies `{type:"auth-ok", role, …}` or closes the socket:
- `4001` invalid/mismatched token · `4404` interview not found or not yours · `4409` a candidate is already streaming · `4403` disallowed Origin · `4400` malformed first message.
- Viewer auth-ok carries `{peer:"<your viewer id>", candidateOnline:bool}`; candidate auth-ok carries `{viewers:[…ids already waiting]}`.

**2. Presence:** `{type:"peer-joined", role, peer?}` and `{type:"peer-left", role, peer?}` tell each side when the other connects/disconnects (`peer` is the viewer id).

**3. Relay the WebRTC handshake** — the server forwards these between peers untouched:
```
{type:"offer",  sdp:…, peer:<viewerId>}   {type:"answer", sdp:…, peer:<viewerId>}   {type:"ice", candidate:…, peer:<viewerId>}
```
- A **viewer** omits `peer` when sending (there's only one candidate); the server tags it with the viewer's id before delivering to the candidate.
- The **candidate** must include `peer:<viewerId>` so the server routes to the right viewer (one candidate can serve several viewers, one WebRTC connection each).

**Client WebRTC config:** `iceServers: [{ urls: "stun:stun.l.google.com:19302" }]` — free, no credentials. If the connection fails to establish, show "live view unavailable" and rely on the recording.

**Consent:** the candidate must be told a recruiter may watch live — this disclosure has to be on the consent screen before enabling the publisher side.

---

## 10. Machine keys (context — not a frontend concern)

Clients' own backends can call the interview engine directly with `X-API-Key: csk_…` (issued in the super-admin console): create interviews, list *their* interviews, read *their* results. Interviews created this way have `createdBy: null` — label as "System / API" in admin views.

## 11. Cron endpoints (never called by a frontend)

`POST /api/admin/sweep-abandoned`, `POST /api/admin/webhook-worker`, `GET /api/admin/webhook-status` — Cloud Scheduler with `X-Admin-Key`. Listed for completeness; they are the only endpoints under `/api/admin/`.

---

## 12. Quick reference — all 84 REST endpoints (+ 1 WebSocket)

**Auth (4):** `POST /api/auth/login` · `POST /api/auth/logout` · `GET /api/auth/me` · `POST /api/auth/change-password`

**Super Admin (20):** `POST|GET /api/platform/admins` · `GET|PATCH /api/platform/admins/{admin_id}` · `POST …/reset-password` · `POST …/disable` · `POST …/enable` · `POST …/tenancy` · `POST|GET …/credentials` · `POST …/credentials/{credential_id}/revoke` · `GET /api/platform/analytics` · `GET /api/platform/audit-logs` · `GET|POST /api/platform/roles` · `GET /api/settings` · `PUT /api/settings/{key}` · `PATCH /api/settings/branding` · `POST|DELETE /api/settings/logo`

**Admin (17):** `GET|PATCH /api/company/profile` · `GET|PATCH /api/company/branding` · `POST|DELETE /api/company/branding/logo` · `GET|PATCH /api/company/interview-defaults` · `GET /api/company/dashboard` · `GET /api/company/audit-logs` · `POST|GET /api/company/hrs` · `GET|PATCH /api/company/hrs/{user_id}` · `POST …/reset-password` · `POST …/disable` · `POST …/enable`

**HR (11):** `POST|GET /api/hr/jobs` · `GET|PATCH /api/hr/jobs/{job_id}` · `POST|GET /api/hr/jobs/{job_id}/candidates` · `POST …/candidates/upload` · `POST …/schedule` · `GET /api/hr/candidates/{candidate_id}` · `POST …/reanalyze` · `POST /api/analyze-resume`

**Interview Engine (25):** `POST /api/create-interview` · `POST /api/send-interview` · `POST /api/resend-otp` · `POST /api/verify-otp` · `POST /api/consent` · `POST /api/submit-answer` · `POST /api/submit-answer-voice` · `POST /api/speech-to-text` · `POST /api/speech-to-text/upload` · `POST /api/heartbeat` · `POST /api/interview-closed` · `POST /api/finish-interview` · `GET /api/interviews` · `GET /api/get-results/{interview_id}` · `POST /api/complete-interview-external` · `POST /api/vitals/init` · `POST /api/vitals/frame` · `GET /api/vitals/report/{session_id}` · `POST /api/recordings/start-upload/{interview_id}` · `GET /api/recordings/upload-state/{id}` · `POST /api/recordings/upload-progress/{id}` · `POST /api/recordings/finalize/{id}` · `POST /api/recordings/cancel/{id}` · `GET /api/recordings/{id}/playback-url` · `POST /api/link-recording/{interview_id}`

**Live (WebSocket, 1):** `WS /api/live/{interview_id}` — WebRTC signaling for live viewing (§9.6).

**Public (4):** `GET /` · `GET /api/health` · `GET /api/branding` · `GET /api/branding/logo`

**Cron (3):** `POST /api/admin/sweep-abandoned` · `POST /api/admin/webhook-worker` · `GET /api/admin/webhook-status`

---

*This document is hand-maintained; the machine-readable truth is always `GET /openapi.json` / `GET /docs` on a running instance. Report gaps to the backend owner.*

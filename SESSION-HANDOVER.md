# RecruiterAI — session handover

Working notes from the session that produced commit `cf4e189`. Written for
whoever (or whatever) picks this up next: what the app does, what was changed,
**what the live API actually does versus what its docs claim**, and what is still
unverified.

- **Repo:** `abhinash-23/RecruiterAi`, branch `main`
- **Stack:** Vite 8 + React 19 + TypeScript, Tailwind v4, Base UI (shadcn-style
  wrappers in `src/components/ui`), TanStack Query, React Router 7
- **Backend:** "CognitiveScreen AI" FastAPI, reached through an ngrok tunnel.
  `API-DOCUMENTATION 1.md` in the repo root is the hand-written spec;
  `GET /openapi.json` on the running instance is the machine truth.
- **Checks used throughout:** `npx tsc -p tsconfig.app.json --noEmit`,
  `npx eslint src`, `npx vite build`. All three pass as of `cf4e189`.

---

## 1. Architecture in one pass

```
src/
  app/            router + providers (QueryClient, Auth, Theme, Router)
  components/
    ui/           Base UI wrappers — treat as vendored, edit sparingly
    shared/       DataTable, IconAction, ApiImage, ConfirmDialog, PhoneInput, …
  config/         navigation.ts (single source for sidebar AND route table),
                  entities.ts (FieldSpec forms)
  features/
    auth/         login, RequireAuth, forced password change, session
    dashboard/    every staff page + its dialogs
    interview/    the candidate sitting (no login)
  services/
    http-client.ts        the only place that calls fetch
    auth-service.ts
    admin/                /api/company/*  (Admin tier) + public branding
    hr/                   /api/hr/*, /api/interviews, /api/get-results
    super-admin/          /api/platform/*, /api/settings
    interview/            candidate-token endpoints
```

**Rules the code follows.** Comments explain *why*, never *what*. Services return
camelCase domain objects and own all snake_case mapping. Pages talk to hooks, not
to service functions. Every role-gated query takes an `enabled` flag rather than
being called and ignored — React Query fires regardless of arguments.

---

## 2. Verified API behaviour (tested live, not read from docs)

These cost real debugging time. Trust this list over the doc where they differ.

| Fact | Evidence |
|---|---|
| `GET /api/get-results/{id}` — **GET only** | `POST` → `405 Method Not Allowed` |
| `completed_at` on `/api/interviews` is an **ISO string**, while `created_at`/`expiry_at` on the same rows are epoch floats | parsing it with the epoch reader returned `null` for every row; fixed with `toMillisFlexible` |
| `POST /api/company/branding/logo` answers `{status, logoUrl}` — **not** `{status, branding}` | live upload returned `{"status":"ok","logoUrl":"/api/branding/logo?company=aaa&v=…"}` |
| `DELETE /api/company/branding/logo` → `{status, message}`, and branding then reports `logoUrl: null` | ran delete + re-read, then restored the logo |
| `GET /api/branding?interview=<interview_id>` resolves the owning company **with no token and no slug** | returned company `logoUrl`; unknown id → platform defaults, HTTP 200 |
| `GET /api/branding/logo?company=<slug>` serves `image/png` | 60 kB PNG |
| **The ngrok tunnel answers header-less browser requests with an HTML interstitial** | `<img src>` got `text/html` (2.8 kB); only the `ngrok-skip-browser-warning` header returns the image. The `?ngrok-skip-browser-warning=true` query form does **not** work. This is why `ApiImage` fetches bytes instead of setting `src`. |
| `POST /api/analyze-resume` is **JSON only** (`resume_text`) — no multipart | only `/hr/jobs/{id}/candidates/upload` parses documents, and that creates candidates |
| `SendInterviewReq` has **no `interview_id`** — `{candidate_email, candidate_name, role, interview_url}` | so the link it emails can never carry one; see §4 |
| `/api/company/*` refuses HR | live response: `{"detail":"Requires a company administrator account."}` — **contradicts the doc**, see §4 |

---

## 3. What this session changed

Grouped by area. Each bullet is a behaviour, not a file list.

### Candidate sitting (`src/features/interview/`)
- **Voice answers rebuilt.** `use-dictation.ts` uses the Web Speech API, so words
  appear live and there is no audio format to negotiate. Multiple-choice speech
  goes through `match-spoken-option.ts` → an option **index**; open answers land
  in the textarea *without* auto-submitting so they can be corrected. The old
  upload path (`/speech-to-text`, `/submit-answer-voice`) remains as a fallback.
- `match-spoken-option.ts` matches on **whole words, never substrings** —
  "I disagree" contains "agree", which on a Likert scale picks the opposite
  answer. 24 cases were compiled and run against the real module; all pass.
- **TTS fixed.** The speak effect depended on the whole `speech` object, which is
  rebuilt every render; the 1-second clock re-render therefore cancelled every
  utterance ~1s in. Now depends on the stable `speak` callback. Also waits for
  `voiceschanged` (Chrome drops a `speak()` issued before voices load) and nudges
  `resume()` every 10s (Chrome cuts long utterances at ~15s).
- **End interview finishes, doesn't abandon.** It used to call
  `/interview-closed`, which the API records as abandonment — the recruiter saw
  "Abandoned" and no report despite every answer being scored. Now runs the same
  `finish-interview` path as the last question, behind a confirmation.
- **Video recording implemented** (`use-recording.ts`): `start-upload` →
  `MediaRecorder` at 5s slices → contiguous `PUT`s straight to the GCS resumable
  URI → `upload-progress` → `finalize` → `link-recording`. Serialised through one
  promise chain because ranges must be contiguous. Entirely best-effort. The REC
  badge now only shows when a recording is genuinely uploading.
- Camera-off button removed; **End interview** moved under the notes card;
  answer pane scrolls with the action bar pinned; per-button loading on the OTP
  screen; company logo on every screen via `?interview=` branding.

### Staff console (`src/features/dashboard/`)
- **Every Actions column is icon buttons** (`components/shared/icon-action.tsx`),
  no `⋯` menus anywhere. Tones: `destructive` for disable/close, `positive`
  (emerald, matching the Active badge) for enable/reopen.
- **DataTable**: `pageSizeOptions` defaults so every table shows *Items per
  page*; default page size **5**; tri-state select-all (a dash for partial —
  measured against *every* filtered row, so locked rows keep it from ticking);
  `isRowSelectable` disables checkboxes for rows that can't be picked.
- **Interviews page**: completed sittings filtered out (they live on Results);
  Score column removed; recruiter dropdown built from the rows' `createdBy`
  (no extra request, only names that match a row); Status filter removed;
  mail + WhatsApp icons open the send dialog with that channel pre-selected;
  **New interview** button → `POST /api/create-interview`.
- **Job shortlist** converted from a hand-rolled list to `DataTable` — search,
  paging, filters. **Row click selects**; the eye icon opens the candidate.
- **Results**: View report is a direct icon; Completed column removed; new
  **Recording** tab (`recording-panel.tsx`, time-limited playback URL fetched per
  view) and a proper **Vitals** panel (`vitals-panel.tsx`) that labels every
  field named in `estimated_only` as estimated, per the doc's requirement.
- **Dashboard** filled out: KPI tiles, admin completion/abandonment meters,
  pipeline breakdown, latest interviews. Deliberately *not* charts — the dataviz
  skill's form table says a handful of numbers is a KPI row, one ratio is a
  meter, and >7 meaningful classes is a table rather than more colours.
- **Resume Analyzer** accepts PDF upload (`src/lib/read-resume-file.ts`, pdf.js
  loaded via dynamic `import()` so it stays out of the main bundle). Text is
  extracted client-side because the endpoint takes text only; `hasEOL` handling
  matters, since flattening a two-column CV changes the score.
- **Branding**: logo upload + delete with confirmation.
- Candidate detail moved from a full-width drawer to a centred dialog.

### Global
- **Scrollbars hidden app-wide** in `src/index.css` (base layer), by request.
- Textarea capped at `max-h-64` — `field-sizing-content` has no upper bound and a
  pasted résumé grew the field past the viewport, taking its dialog with it.
- Dialogs capped at `max-h-[calc(100dvh-2rem)]` with scroll: they are centred by
  transform, so anything taller loses its top *and* its footer unreachably.
- Phone fields everywhere use the country-code `PhoneInput` (E.164).

---

## 4. Open issues — backend, not frontend

1. **HR cannot read `/api/company/branding`.** §5 and §7 of the doc both promise
   it is "readable by any of the client's staff, admin and HR alike"; the live
   server returns `Requires a company administrator account`. The frontend
   already asks for it on HR's behalf and silently falls back to the product
   mark. **Fix:** allow `role: "hr"` on that GET, keeping `PATCH`/logo
   admin-only. No frontend change needed afterwards.
2. **`POST /api/send-interview` emails an unusable link.** Its body has no
   `interview_id`, so the link it composes (from email/name/role) omits it and
   the candidate hits "This link isn't complete". Mitigated on our side by
   sending `interview_url` in **path form** (a `#/otp?…` fragment is invisible to
   a server-side URL parse) and by showing the recruiter the correct link after
   sending. **Real fix:** honour `interview_url` verbatim, or accept an
   `interview_id`.
3. **No recording id on any staff read.** `get-results` returned no
   `recording_session_id` field for a completed interview. The player reads both
   spellings and shows "No recording" until one appears, so the moment the
   backend surfaces it, playback lights up.
4. **Data isolation off for tenant `aaa`.** Fix from Admin Management → the
   shield icon → `POST /api/platform/admins/{id}/tenancy {enforced:true}`. The
   doc says to make this part of the create-admin flow; it isn't yet.

---

## 5. Not verified — treat as unproven

- **Dictation with a real microphone.** Written and type-checked, never spoken to.
- **The recording upload pipeline end-to-end.** Needs a webcam sitting plus
  storage configured; also depends on CORS allowing `PUT` to the GCS session URI.
- **`POST /api/create-interview` response shape.** Its OpenAPI 200 is untyped;
  the reader accepts both snake and camel spellings for id/link/otp/emailSent. A
  live run would confirm it — note it emails a real candidate.
- **`/api/company/dashboard`'s `byStatus` key spelling.** The pipeline card
  lowercases keys and appends unrecognised ones rather than dropping counts.
- **Whether `send-interview` now preserves the path-form query.**
- Every token captured during the session has expired; re-auth before probing.

---

## 6. Continuation prompt

Paste this into a fresh session:

> I'm continuing work on the RecruiterAI frontend at `d:\RecruiterAi` (repo
> `abhinash-23/RecruiterAi`, branch `main`, last commit `cf4e189`).
>
> Read `SESSION-HANDOVER.md` in the repo root first — it has the architecture,
> what was built last session, the live API behaviours that contradict the docs,
> the open backend issues, and what is still unverified. `API-DOCUMENTATION 1.md`
> is the API spec; `GET /openapi.json` on the running backend is the machine
> truth and worth checking before trusting either.
>
> Conventions to keep: comments explain *why* not *what*; services own all
> snake_case↔camelCase mapping and pages talk to hooks only; role-gated queries
> take an `enabled` flag (HR must never call `/api/company/*` — it 403s); Actions
> columns use icon buttons via `components/shared/icon-action.tsx`, never `⋯`
> menus; verify with `npx tsc -p tsconfig.app.json --noEmit`, `npx eslint src`
> and `npx vite build` before saying anything is done.
>
> Note the three pre-existing `react-refresh/only-export-components` lint errors
> in `src/components/ui/{badge,button,tabs}.tsx` — vendored files, not mine.
>
> Next task: <describe what you want>

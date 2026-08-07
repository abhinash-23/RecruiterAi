# RecruiterAI — session handover

Working notes, appended one session at a time. Written for whoever (or whatever)
picks this up next: what the app does, what was changed, **what the live API
actually does versus what its docs claim**, and what is still unverified.

- **§1–§6** — session 1, up to commit `cf4e189`
- **§7** — session 2, `cf4e189` → `3010748`, which ends with the app **deployed
  to Cloud Run**

- **Repo:** `abhinash-23/RecruiterAi`, branch `main`
- **Stack:** Vite 8 + React 19 + TypeScript, Tailwind v4, Base UI (shadcn-style
  wrappers in `src/components/ui`), TanStack Query, React Router 7
- **Backend:** "CognitiveScreen AI" FastAPI, reached through an ngrok tunnel.
  `API-DOCUMENTATION 2.md` in the repo root is the hand-written spec (renamed
  from `… 1.md` during session 2); `GET /openapi.json` on the running instance is
  the machine truth.
- **Checks:** `npm run build` (which is `tsc -b && vite build`) and
  `npx eslint .`. Both pass as of `3010748`. Session 1 used narrower commands;
  prefer these — the whole-repo lint catches what `eslint src` does not.

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

Superseded by **§7.8** — use that one. It carries session 1's conventions
forward, so nothing is lost by skipping this.

---

# 7. Session 2 — `cf4e189` → `3010748`

Seven commits. Roughly half feature work on the sitting and the console, half
getting the thing deployed and then fixing what deployment exposed.

```
63beaab  feat: profile pictures, theme-aware logos, and live voice interviews
d5411d5  fix: hold the sitting when the camera can't see the candidate, …
3a4c706  build: containerise the app for Cloud Run
e7324a3  fix: the container served an app that could not reach its own API
eadda90  fix: résumé PDF upload was broken in the container, plus caching …
43ad8c2  chore: clear the last lint errors and add deploy guards
3010748  fix: container failed to start on Cloud Run — resolver script …
```

**Live at** `https://recruiterai-fe-610993990979.europe-west1.run.app`
(region `europe-west1`, service `recruiterai-fe`). Serving correctly; see §7.6
for the two environment variables still unset.

---

## 7.1 Candidate sitting — voice control rewritten again

Session 1 left dictation as press-to-talk per answer. It is now **one microphone
for the whole sitting**.

- `use-dictation.ts` treats the words as a *stream*: `settled` (committed),
  `text` (settled + in-flight guess), `consume()` (take them, leave the mic
  running). Chrome ends a `continuous` recogniser at every pause, so a new
  session is spawned underneath the candidate and the buffer carries over.
- **Three things had been conflated** and each conflation was a bug: the
  candidate's intent (`wantRef`), the browser session (`recognitionRef`), and the
  unconsumed words (`settledRef`). A stale session left the mic button
  permanently dead ("your browser wouldn't start the microphone"), and a
  discarded session kept its `onresult` handler and leaked one answer's words
  into the next question.
- **Acting on what's heard.** A named letter ("option B") fires mid-phrase — it
  cannot become a different option. The option's own words wait for the
  recogniser to settle, because "strongly…" is the start of two opposite Likert
  answers. Open answers land in the box as they settle; "send answer" submits.
- **The recogniser goes deaf while the host speaks.** Elena reads the question
  *and every option* aloud, so on speakers the mic hears "A. Strongly Disagree"
  and answers for the candidate. Two grace windows cover what a flag cannot:
  `speechSynthesis` reports itself started a beat after it makes a sound, and the
  words that answered the last question are still settling when the next arrives.
- `match-spoken-option.ts` gained cue-chains ("the answer is B"), digits and
  number words, last-cue-wins for self-correction, and a `via` field
  (`letter` | `phrase` | `partial`) so the live path can act on a letter
  immediately but never on a partial. 24 cases still pass.

## 7.2 The camera must see the candidate

`sendVitalsFrame` already returned `faceDetected` and **nothing read it**.

Six seconds of no face now *holds* the sitting: question covered, controls dead,
microphone closed, clock stopped, `send()` refuses even a voice match already in
flight. It resumes on its own. Camera-off is treated the same way, since no
frames means the flag never arrives at all.

Six seconds and not zero because the flag drops for a turn of the head. **A
failed vitals request is not a missing face** — only an explicit `false` counts,
so a 500 can never halt an interview. The camera pane stays clear behind the
overlay: being told you are off camera is no use if you cannot see yourself.

Pausing the clock was a judgement call, not a requirement — they cannot answer
during the hold, and it cannot be used to buy thinking time because nothing can
be submitted either.

## 7.3 Profile pictures, theme-aware logos

Both from `PROFILE-PICTURE-FRONTEND-GUIDE.md` (in Downloads, not the repo).

- `services/profile/` routes one function to two doors — admin
  `PATCH /company/profile`, HR `PATCH /hr/profile`. That routing exists to close
  a trap: on the admin door `name` is the **company's** name, and
  `updateCompanyProfile` still sends it that way. The person's name is
  `full_name`, on both doors.
- The picture is edited in a LinkedIn-style dialog — hover or focus the avatar,
  see it at 224px, Update / Delete. Everything lives in the one Account card;
  an earlier two-card version printed the name twice and implied two saves.
- **Two logo slots, dark and light**, previewed on fixed swatches rather than
  theme tokens — the point is to see the logo on the background it will land on.
  `useThemedLogo` picks the slot from `resolvedTheme`, which the theme provider
  did not expose before ("system" resolves correctly now).
- **`GET /api/auth/me` was never called by this app.** It ran entirely on the
  login response, which carries no `profilePictureUrl` — so a picture set in an
  earlier session was invisible until re-uploaded, and every sign-out lost it.
  `AuthProvider` now hydrates from it once per session, keyed on the token.
- The picture URL is **bearer-authenticated**, which `fetchApiAsset` did not
  account for (it was written for the public branding logo). It now attaches the
  token, registered by `auth-service` rather than imported, to keep
  `http-client` at the bottom of the stack.

## 7.4 Everything else in the console

- **Vitals panel** rebuilt as stat tiles with per-metric icons, reference-range
  tracks *only where the range is textbook* (heart rate, SpO₂, respiratory rate;
  **not** glucose — its reference depends on time since eating — and not blood
  pressure, which is two numbers). An organ glyph per card, and **only the heart
  animates**. No status colours on the tiles: the API sends no classification,
  and a red card on a webcam-derived reading implies a verdict this doesn't have.
- **Live interview view**: three columns — vitals, the candidate with the current
  question beneath, the conversation. Vitals are withheld for the first **ten
  frames (~30s)**: rPPG reads a pulse from variation *across* frames, so the
  first few are arithmetic on noise. Counted in frames, not wall clock, so a
  recruiter joining at minute ten doesn't wait for readings that settled long ago.
- `VitalsPanel` is a **container query** now. Viewport breakpoints put three
  tiles into a 500px column and truncated every label to "T..".
- **New interview dialog**: PDF upload for both the JD and the résumé (read in
  the browser, dropped into the box so it can be checked before sending), job
  title as a curated dropdown with a free-text escape, wider dialog, fields side
  by side — and **the interview link and OTP are no longer shown**. That code is
  a credential for someone else's sitting; the link is rebuilt from the row by
  *Send invite*, and `resend-otp` posts a fresh code to the candidate's inbox.
- **Landing page**: the live-preview dialog was auto-height on three of its four
  steps and is centred by transform, so every step change moved it about its own
  middle. One height throughout. The demo's live step was rebuilt to mirror the
  real room, its camera tile never showed a face (the stream was assigned while
  the `<video>` did not yet exist), and the Live Preview tab leapt half its own
  height on click — `Button` carries `active:translate-y-px`, which in Tailwind
  v4 writes the same `translate` property as `-translate-y-1/2` and replaced it.
- **The dev proxy was eating a static file.** `vite.config.ts` keyed the proxy on
  the string `"/api"`, which Vite matches as a *prefix* — so
  `/api-architecture.png` was forwarded to the backend and 404'd. Now a regex,
  `^/api(?:/|$)`.
- Product watermark on every screen; *Jump to* moved under the pipeline.

## 7.5 Deployment — and the four bugs only deployment found

`Dockerfile` + `docker/` + `.dockerignore` + `.gcloudignore`. Multi-stage:
`node:22-alpine` builds, `nginxinc/nginx-unprivileged:1.27-alpine` serves.
97 MB, uid 101, no toolchain at runtime.

nginx forwards `/api` to `API_PROXY_TARGET`, read at container start — so one
image serves staging and production, and **nothing is cross-origin**, which
matters because a Cloud Run URL changes whenever the service is recreated.

**Each of the four passed local testing and failed anyway. Worth reading before
touching the image.**

1. **The app could not reach its own API.** `ARG VITE_API_BASE_URL=""` — but
   `ENV` always sets the variable, so Vite got an empty string, and the app's
   `?? "/api"` did not fire because `??` only falls back on nullish. The whole
   expression folded to `""` and every call went to `/auth/login`, which the SPA
   fallback answers with index.html **and a 200** — surfacing as
   `unexpected token '<'`. *Survived testing because I curled nginx's routes,
   never the path the app itself calls.* Fixed with `||` in `http-client.ts` and
   `session.ts`, plus an ARG default of `/api`.
2. **Résumé PDF upload was broken.** nginx's `mime.types` has no `.mjs` entry,
   PDF.js ships its worker as an ES module, and a browser refuses to execute a
   module script served as `application/octet-stream`. *Invisible in dev, where
   Vite serves the module with the right type itself.* `mime.types` is patched in
   the image, and the build greps for its own edit so a future base image fails
   the build rather than shipping the bug again.
3. **The container refused to start on Cloud Run:**
   `[emerg] host not found in resolver "${NGINX_RESOLVER}"`, because
   `10-resolver.envsh` was skipped — "not executable". **Docker for Windows
   invents a 0755 mode** for files copied from NTFS, so the bit existed on the
   machine that built it and nowhere else; Cloud Build runs on Linux. Fixed by
   *deleting* the script: the image already ships `15-local-resolvers.envsh`,
   opt-in via `NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1`.
4. **A literal `proxy_pass` host would take the whole site down** whenever the
   backend was unresolvable, because nginx resolves it while *loading the
   config*. The target now goes through a variable with a per-request resolver,
   so the site serves and only `/api` 502s.

Also fixed in the same pass, all verified against a running container: no
security headers at all; `X-Forwarded-Proto: $scheme` told the backend the
session was insecure (Cloud Run terminates TLS at its edge, so absolute URLs
built from it come back `http://` and are blocked as mixed content — which is
the shape of the profile-picture and logo URLs this app renders); `public/`
files had **no** cache policy, ~10 MB revalidated on every visit; `no-store` on
index.html was disabling the back/forward cache; `server_tokens` was advertising
the exact nginx build.

**Two nginx behaviours worth knowing before editing
`docker/nginx.conf.template`:**

1. `add_header` in a `location` **silently drops every header inherited from
   above it**. That is why the security headers live in an `include` file and are
   re-included in each location that sets a header of its own.
2. `^~ /assets/` is a prefix match that beats a regex. The extension regex added
   for `public/` files would otherwise steal the year-long cache from the fonts
   inside `/assets/`.

## 7.6 Open issues

**Deployment — two environment variables, in two different places.**

1. **`API_PROXY_TARGET` is unset on the deployed revision.** `/api/health`
   returns 502 (verified live). The site serves, but nothing can log in.
   ```
   gcloud run services update recruiterai-fe --region=europe-west1 \
     --set-env-vars API_PROXY_TARGET=https://<backend>
   ```
2. **The backend still emits `http://localhost:5173/#/otp?…` in invitation
   emails.** Not a frontend bug: `buildInterviewLink` uses
   `window.location.origin` and produces *path* form; the hash form proves the
   backend composed it. `POST /api/create-interview` accepts no base-URL
   parameter, so it comes from the backend's own config — set its `FRONTEND_URL`
   (or equivalent) to the Cloud Run URL. **Workaround that already works:**
   *Send invite* on an interview row passes `interview_url` built from the
   browser's origin, so it emails a correct link today.
3. **Deploy with `--timeout=3600`.** Cloud Run counts a WebSocket as one request
   and cuts it at the timeout. Live viewing holds a socket for the whole sitting
   and **neither end reconnects** (`use-live-viewer.ts` sets `unavailable` on
   close), so the 300s default drops every live view five minutes into a
   half-hour interview.
4. **Cloud Run sends `SIGTERM`; nginx treats that as a fast shutdown** and drops
   in-flight requests. The base image's `STOPSIGNAL SIGQUIT` is ignored by the
   platform. Only bites requests running when a revision is replaced. Needs an
   entrypoint wrapper that traps `SIGTERM` and forwards `SIGQUIT`.
5. **The backend is an ngrok tunnel**, whose hostname changes on every restart.
   Each change needs a `gcloud run services update`. Deploy the backend properly
   before this becomes a habit.
6. Session 1's open issues (§4) were **not** revisited and are presumed to stand.

**Environment — unexplained, and it cost real work.** Three root-level `.md`
files and the whole `docker/` directory were deleted from the working tree
**twice**, between commands, while only the IDE was active. `Dockerfile` and
`.dockerignore` survived both times; `src/` was untouched. No git hook, npm
script or reflog entry explains it, and `git clean` would have taken more.
Everything is committed now, so a recurrence is a `git checkout --` away — but
find the culprit before it takes something uncommitted.

## 7.7 Not verified — treat as unproven

- **Camera and microphone on the deployed HTTPS origin.** `getUserMedia` needs a
  secure context, which Cloud Run provides, and the `Permissions-Policy` header
  explicitly allows `camera=(self)` — but no sitting has been run against it.
- **Résumé PDF upload in production.** The MIME fix is verified at the HTTP
  level (`application/javascript`); the worker has not been watched to parse a
  real PDF from the deployed site.
- **Live viewing through the Cloud Run proxy.** The WebSocket upgrade headers are
  configured and `/api` proxies correctly, but no peer connection has been formed
  end to end, and item 3 above is unresolved.
- **The face-detection hold against a real vitals feed.** Written and reasoned
  through; never watched with a candidate leaving the frame.
- **Continuous dictation across a whole 30-question sitting.** The rewrite is
  logically verified and unit-tested at the matcher level only.

## 7.8 Continuation prompt

Paste this into a fresh session:

> I'm continuing work on the RecruiterAI frontend at `d:\RecruiterAi` (repo
> `abhinash-23/RecruiterAi`, branch `main`, last commit `3010748`). It is
> deployed to Cloud Run at
> `https://recruiterai-fe-610993990979.europe-west1.run.app`.
>
> Read `SESSION-HANDOVER.md` in the repo root first — §1–§6 are the architecture
> and session 1, §7 is session 2 and ends with the deployment. §2 lists live API
> behaviours that contradict the docs; §7.5 lists four bugs that passed local
> testing and failed in production; §7.6 the open issues and §7.7 what is still
> unproven. `API-DOCUMENTATION 2.md` is the API spec; `GET /openapi.json` on the
> running backend is the machine truth.
>
> Conventions: comments explain *why* not *what*; services own all
> snake_case↔camelCase mapping and pages talk to hooks only; role-gated queries
> take an `enabled` flag (HR must never call `/api/company/*` — it 403s); Actions
> columns use icon buttons via `components/shared/icon-action.tsx`, never `⋯`
> menus.
>
> Verify with `npm run build` and `npx eslint .` — both are clean at `3010748`,
> so anything they report is yours. If you touch the container, **build it, run
> it, and read the rendered `/etc/nginx/conf.d/default.conf`** rather than only
> checking that it answers requests: every deployment bug last session passed a
> curl test first.
>
> Next task: <describe what you want>

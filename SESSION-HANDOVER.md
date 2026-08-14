# RecruiterAI — session handover

Working notes, appended one session at a time. Written for whoever (or whatever)
picks this up next: what the app does, what was changed, **what the live API
actually does versus what its docs claim**, and what is still unverified.

- **§1–§6** — session 1, up to commit `cf4e189`
- **§7** — session 2, `cf4e189` → `3010748`, which ends with the app **deployed
  to Cloud Run**
- **§8** — session 3, `cb58cc7` → `a6dcec0`: interview integrity counters,
  fullscreen and tab-switch proctoring, the invitation link that had never
  worked, and `candidate-interview-page.tsx` split into nine files
- **§9** — session 4, `a6dcec0` → `0ced335`: recording and live viewing both
  re-pointed at new backend WebSocket contracts (WebRTC deleted outright),
  requests reduced to mount-and-invalidation only, and two more nginx
  socket bugs. ⚠️ **§9.8 lists what §7 and §8 now get wrong — read it first.**

- **Repo:** `abhinash-23/RecruiterAi`, branch `main`
- **Stack:** Vite 8 + React 19 + TypeScript, Tailwind v4, Base UI (shadcn-style
  wrappers in `src/components/ui`), TanStack Query, React Router 7
- **Backend:** "CognitiveScreen AI" FastAPI. **No longer an ngrok tunnel** as of
  session 4 — it is deployed at
  `https://recruiterai-backend-610993990979.us-east4.run.app` (so §2's ngrok
  interstitial note is historical, though the header it explains is harmless).
  `API-DOCUMENTATION 2.md` in the repo root is the hand-written spec and is now
  far behind; `GET /openapi.json` on the running instance is the machine truth —
  except for WebSocket routes, which it cannot see at all (§9.6).
- **Checks:** `npm run build` (which is `tsc -b && vite build`) and
  `npx eslint .`. Both pass as of `0ced335`. Session 1 used narrower commands;
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

---

# 8. Session 3 — `cb58cc7` → `a6dcec0`

Three commits. Two features the backend team specified mid-session, one bug that
had been breaking every invitation link since deployment, a palette fix, and a
refactor of the largest file in the app.

```
7a87962  fix: invitation links dropped candidates on the marketing page
b7b2ca0  feat: neutral console palette, and a sidebar you can read
a6dcec0  feat: interview integrity — camera, out-of-frame and tab-switch counts
```

Pushed to **both** remotes: `origin/main` (`abhinash-23/RecruiterAi`) and
`company/superadmin-admin-hr` (`Citimedia/RecruiterAI-FrontEnd`). The company
push was a clean fast-forward.

⚠️ **The two repos have unrelated histories.** `superadmin-admin-hr` and `dev`
on the Citimedia repo share no common ancestor — `git merge-base` returns
nothing, and GitHub refuses to open a PR between them ("entirely different
commit histories"). This branch is a full rewrite: 429 files, ~34k insertions
against ~164k deletions, removing the whole `server/` directory, the old pages
and the i18n dictionaries. Landing it is a team decision, not a merge. To make a
PR mechanically possible: `git merge company/dev --allow-unrelated-histories -s
ours`, which records `dev` as an ancestor while keeping this tree.

---

## 8.1 Interview integrity — the counters and the panel

Two backend handoffs arrived mid-session. Both are additive; nothing existing
changed shape.

**Server-measured** (`camera_off_count`, `camera_off_seconds`,
`face_absent_count`, `face_absent_seconds`, `absence_events`) — derived from
frames the backend received, and not fakeable by the candidate. Counts are
*episodes*, already de-noised server-side at a ~1.5s threshold, so the panel
renders them as given.

**Browser-reported** (`tab_switch_count`) — a tab switch is only observable
inside the candidate's browser, so we own the counting entirely and the API is a
carrier. Three rules that matter:

| Rule | Why |
|---|---|
| **Cumulative, never a delta** | The server keeps the maximum it was given, so a late or out-of-order frame can't rewind the count and nothing needs sequencing |
| **Sent on both `/vitals/frame` and `/finish-interview`** | Finish is authoritative and lands even when the camera died earlier and took the frame traffic with it |
| **`null` ≠ `0`** | `null` means never reported; `0` means tracked and clean. The panel renders `null` as **"Not tracked"**, and an untracked count cannot earn the "No interruptions" badge |

New: [`integrity-panel.tsx`](src/features/dashboard/integrity-panel.tsx), shown
on the results page above the vitals readings. Three counters in one row, a
collapsible episode timeline, and an ℹ️ marking the browser-reported figure as
softer evidence than the camera measurements.

`toIntegrityReport` is parsed **independently of `toVitalsReport`**, which
returns null when a sitting produced no readings — exactly the sitting these
counters have most to say about. Folding them together would hide "camera off
for eleven minutes" behind "no vitals were captured", when the first explains
the second.

Counts also tolerate the string form on the wire (`"5"` as well as `5`). A count
silently read as null becomes "Not tracked" on a recruiter's screen, which reads
as an unmonitored interview — a worse failure than it looks. Measurements stay
strict.

**Verified working end to end** during the session: a real sitting produced
`Left the tab 4×` on the results page.

## 8.2 Fullscreen and tab switching — [`use-proctoring.ts`](src/features/interview/use-proctoring.ts)

The room enters fullscreen from the Start click. `requestFullscreen` is fired in
the click handler's **synchronous path, before any `await`** — the first await in
an async body ends the user-gesture window and the request is rejected.

**Leaving fullscreen is recorded, not enforced.** An earlier iteration held the
sitting — question covered, clock stopped — which was reverted on request: Escape
and F11 are untrappable in every browser by design, and freezing an interview
over an accidental keypress punished the accident more than it deterred the
misuse. `faceLost` remains the only condition that holds the room.

A **Fullscreen button** sits in the room's top bar, and is hidden once
fullscreen: offering an Exit control on the interview chrome invites the
candidate to leave. Hidden entirely where the API is absent — notably iOS
Safari, which has no Fullscreen API outside `<video>`, so that whole feature
does not exist on iPhone.

`navigator.keyboard.lock(["Escape"])` makes a single Escape tap not exit — the
user must hold it ~2s. Chromium desktop only, released on every exit path
(button, `fullscreenchange`, effect cleanup) so a candidate's Escape key is
never left captured on the next page.

Tab switches are counted at a **1.5s minimum**, matching the backend's own
camera threshold so a recruiter isn't comparing two differently filtered figures.
The count lives in a **ref**, read through a stable callback: the vitals interval
captures its closure once, so reading render state there would ship the count as
it stood at the start of the sitting, forever.

⚠️ **Fullscreen exits are not reported anywhere.** The API has no field for
them; the first implementation invented a `POST /api/proctoring` endpoint with
episode events, which the real contract superseded. That plumbing was removed
rather than left collecting a number that can't be sent.

## 8.3 The invitation link that had never worked

`FRONTEND_BASE_URL` carried a trailing slash, so emailed links arrived as
`https://host//#/otp?…` — pathname `//`, not `/`. `normaliseHashRoute` guarded on
`pathname !== "/" && pathname !== ""`, which `//` satisfies, so the rewrite never
ran and **every invited candidate landed on the marketing page.**

Root now means any run of slashes (`/^\/*$/`). Verified against the real URL and
against the cases the guard existed to protect: a stale hash on a real route
(`/admin/live`) and the landing page's own anchors (`#home`, `#api`) are still
left alone.

The backend has since stripped the trailing slash too, so this is now belt and
braces. **Confirmed for the backend team: `/#/otp` reaches the OTP screen.** Path
form (`/otp?…`) remains strictly better — a fragment is invisible to a
server-side URL parse, which is why `send-interview` rebuilds links without an
`interview_id` (§4.2).

## 8.4 Console palette — the red wash

Every "neutral" in the theme was mixed at hue 320–326 (magenta) with up to
0.024 chroma, putting a red cast on the background, every card, every meter track
and all secondary text at once. Now chroma 0 throughout, so colour in the console
comes only from the accent and the status hues.

Two things fixed alongside:

- The sidebar borrowed `bg-background` — the same colour as the page. It now uses
  the `--sidebar` tokens that were defined but never wired up, set one step
  behind the page so rail, page and cards read as three layers.
- The active nav item was hardcoded `text-brand-blue` (`#0052ff`) on a near-black
  rail: **under 3:1 contrast**. A new theme-aware `--accent-brand` keeps the true
  brand value in light mode and lifts the same hue into legibility in dark.

`--color-brand-blue` is deliberately untouched — the landing page uses it as a
solid fill behind white text, and lightening it globally would wash those out.

## 8.5 The vitals rPPG migration — built, then reverted

A third handoff described migrating vitals to an external rPPG provider: capture
at 10–15 fps instead of 0.33, Baevsky stress scale (~50–500 rather than 0–100),
BP/glucose/SpO₂ becoming honest `null`, plus HRV, wellness, `signal_quality`,
`summary`/`coverage` and a `disclaimer`.

It was implemented in full, then **reverted at the user's request** — the whole
change, cleanly, leaving the palette and link fixes intact. Two findings worth
keeping:

1. **`VITALS_FRAME_MS` was 3000 (0.33 fps).** rPPG needs 10–15 fps because a
   heartbeat is 1–1.7 Hz; at 0.33 fps the pulse is simply not present in the
   data. If vitals are ever wired to the new provider, this is the change that
   matters — everything else is presentation.
2. **A naive 80ms `setInterval` around an async post is an unbounded queue.**
   Needs an in-flight cap and a throttle on the React state write, or the tab
   falls minutes behind sending frames stamped with times long past.

**The backend has not deployed this migration.** A live payload captured this
session still returns `systolic_bp: 120.0`, `glucose_mg_dl: 95.0`, `spo2: 97.5`
and a full `blood_markers` block — the fabricated constants the handoff said
would become null.

## 8.6 `candidate-interview-page.tsx` split into nine files

**1,249 → 516 lines.** A pure move: verified nothing was removed by checking the
committed original for user-facing strings (14), functions and refs (23), API
calls and hooks (22), timing constants (5) and CSS classes (26). All present.

```
screens/shell.tsx          Shell, PreparingCard, LoadingScreen
screens/code-screen.tsx    OTP entry
screens/consent-screen.tsx
screens/camera-screen.tsx
screens/status-screens.tsx done / closed / incomplete link
use-voice-answers.ts       host's voice, candidate's voice, option matching
use-vitals-sampler.ts      webcam frames + the face-lost hold
use-sitting-lifecycle.ts   keep-alive, abandonment beacon, the clock
```

Three fragile patterns were preserved deliberately, each documenting a bug
already paid for:

- The read-aloud effect depends on **`speak`, not `speech`** — the object is
  rebuilt every render and the clock re-renders once a second, which cancelled
  every utterance a second in.
- `handleHeard` goes through **`heardRef`**: the recogniser is created once but
  needs the current question.
- **`answerRef` stays in the page.** Dictation delivers several updates inside
  one render, each building on the last.

`faceLost` lives with the vitals sampler because both come from the same
response — every frame returns the reading *and* `face_detected`.

⚠️ There is a deliberate declaration cycle in the page: `voice` needs `send`,
`send` needs `finishSitting`, `finishSitting` needs `voice`. It resolves because
closures capture bindings rather than values, and nothing calls `send` during the
render pass. Commented at the call site — don't "fix" it by reordering.

## 8.7 Deployment preflight — the Dockerfile is sound

Built the image and **ran it** rather than reading it. All green:

| | |
|---|---|
| Builds, runs as uid 101 | ✅ |
| `listen 9099` from injected `$PORT` | ✅ |
| `resolver` substituted (the §7.5 bug) | ✅ |
| No unsubstituted `${…}` outside comments | ✅ |
| SPA deep links 200, missing asset 404 | ✅ |
| `/api` beats the fallback (502, not HTML) | ✅ |
| `.mjs` → `application/javascript` | ✅ |
| index `no-cache`, assets `immutable`, public 1h | ✅ |
| gzip, security headers, healthcheck | ✅ |
| `npm ci` lockfile in sync | ✅ |
| `.env` excluded from both ignore files | ✅ |

**No changes needed.** Deploy reminders: keep `--timeout=3600` (Cloud Run counts
a WebSocket as one request; at the 300s default every live view dies five
minutes into a sitting), and set `API_PROXY_TARGET` or `/api` 502s while the site
otherwise serves fine.

## 8.8 Verified API behaviour (new this session)

| Fact | Evidence |
|---|---|
| `tab_switch_count` is cumulative, **max-wins**, and `null` ≠ `0` | Backend handoff, and a live sitting rendering `4×` |
| It is **not** echoed on `/vitals/frame` responses | By design — we hold the source number |
| `get-results` → `vitals_report` still carries **no `recording_session_id`** | Live payload captured this session |
| The vitals rPPG migration is **not deployed** | Same payload still returns `120/80`, `95.0`, `97.5`, full `blood_markers` |
| `absence_events` carries only `camera_off` / `face_absent` | No tab or fullscreen entries; those have no timeline |
| `API-DOCUMENTATION 2.md` knows **none** of the integrity fields | It is now behind three handoff documents |

## 8.9 Open issues

1. **Recording playback is still dead.** `get-results` returns no
   `recording_session_id`, so the player has no id to request a playback URL
   with. The video may be in storage; nothing points at it. The panel reads both
   spellings, so playback lights up the moment either appears. **Unchanged since
   session 2** — this is the single highest-value backend fix.
2. **Fullscreen exits have no carrier field.** Needs a `fullscreen_exit_count`
   following the same max-wins pattern; trivial to wire once it exists.
3. **`GET /api/recordings/upload-state/{id}` is never called.** The spec lists it
   for resuming an interrupted upload; a dropped connection mid-sitting just
   stops. Not worth adding before the pipeline is proven working at all.
4. **`README.md` is still the stock Vite + shadcn template.** Anyone landing on
   the repo gets boilerplate about adding components.
5. §7.6 items 1–4 (HR branding 403, `send-interview` link, data isolation for
   tenant `aaa`) — **all still open.**

## 8.10 Not verified — treat as unproven

- **The nine-file refactor at runtime.** Static verification proves nothing was
  deleted; it cannot prove the wiring is right on every path. The voice flow has
  the most moving parts — one real sitting would settle it.
- **The recording pipeline end to end.** Unchanged from §7.7. Also depends on the
  GCS bucket's CORS allowing `PUT` from the Cloud Run origin — if that is wrong,
  every chunk fails silently, because the whole path is best-effort.
- **Fullscreen behaviour on a real candidate machine.** Written and reasoned
  through; the Escape lock is Chromium-only and untested against a real refusal.
- **The integrity panel against a sitting with genuine `camera_off` episodes.**
  Only `face_absent` has been seen in a live payload — note there is currently
  **no in-app way to turn the camera off** (`toggleCamera` exists in
  `use-media-stream.ts` but nothing calls it), so producing one needs an
  OS-level disable.

## 8.11 Continuation prompt

Supersedes §7.8. Paste into a fresh session:

> I'm continuing work on the RecruiterAI frontend at `d:\RecruiterAi` (repo
> `abhinash-23/RecruiterAi`, branch `main`, last commit `a6dcec0`; also pushed to
> `Citimedia/RecruiterAI-FrontEnd` branch `superadmin-admin-hr`). Deployed to
> Cloud Run at `https://recruiterai-fe-610993990979.europe-west1.run.app`.
>
> Read `SESSION-HANDOVER.md` first — §1–§6 architecture and session 1, §7 session
> 2 and the deployment, §8 session 3. §2 and §8.8 list live API behaviours that
> contradict the docs. §8.9 is the open issues, §8.10 what is unproven.
> `API-DOCUMENTATION 2.md` is the spec but is now **behind three backend handoff
> documents** — trust a live payload over it.
>
> Conventions: comments explain *why* not *what*; services own all
> snake_case↔camelCase mapping and return camelCase domain objects; pages talk to
> hooks, not to service functions; role-gated queries take an `enabled` flag (HR
> must never call `/api/company/*` — it 403s); Actions columns use icon buttons
> via `components/shared/icon-action.tsx`, never `⋯` menus.
>
> Verify with `npm run build` and `npx eslint .` — both clean at `a6dcec0`, so
> anything they report is yours. If you touch the container, **build it, run it,
> and read the rendered `/etc/nginx/conf.d/default.conf`** — every deployment bug
> in session 2 passed a curl test first.
>
> Next task: <describe what you want>

---

# 9. Session 4 — `a6dcec0` → `0ced335`

Seven commits, 43 files, +3,482 / −2,063. Two backend handoffs arrived mid-session
and each replaced a contract this app had already built against, so roughly half
the work is *deleting* things that worked and re-pointing them at a better route:

```
5e9a33b  perf: read on demand instead of on a timer
ab0c611  feat: stream interview recordings over the backend's WebSocket relay
076af55  build: keep nginx from cutting the WebSockets at five minutes
adbf5f8  fix: the landing page's dead hero video and its unreadable text
1101db7  feat: live view through the backend relay, with the questions and answers
10f7894  build: route the relay socket to the long-timeout location
0ced335  feat: the hero's candidate feed plays a real video again
```

Pushed to both remotes, both clean fast-forwards. Work left **uncommitted** at the
end of the session is listed in §9.7 item 8.

---

## 9.1 Reads happen on demand — and the two wrong turns getting there

The complaint was "I add something and it isn't there until I reload". The cause
was a 30s `staleTime` with `refetchOnMount` deferring to it: navigating back to a
list inside that window re-used the cache, and the refetch that *had* fired ran
against a server which committed a moment later. So the cache held pre-write data
and was considered fresh.

**Both first attempts were worse than the problem, and the reasons generalise.**

1. A client-wide `refetchInterval: 15s` does not poll "the page you're on" — it
   polls whatever is mounted, and `NotificationsMenu` in the dashboard layout is
   mounted on *every* page. The audit log was re-read every 15 seconds forever, on
   top of whatever the page itself held. Hundreds of requests in a network log,
   exactly as reported.
2. `refetchOnWindowFocus: true` sounds free because it is user-driven. It isn't:
   with DevTools docked beside the app, every click from the panel back into the
   page is a focus event, and each one past `staleTime` re-requested everything on
   screen.

**Where it landed: two triggers, and no third.** Opening a page that needs the
data, and a write that invalidates it. `refetchOnMount: "always"` is the only
automatic read — one request per visit, per query that page needs — and it is not
optional, because deferring to `staleTime` is what caused the original bug.

Timers exist only where something outside this browser changes the answer, and each
read sets its own: the live pages (10s), live vitals (8s), and the shortlist at 4s
**while a fit score is pending, stopping the moment none are**.

Two other things came out of it:

- `services/derived-reads.ts` — writes now invalidate what *summarises* them.
  Creating a job moves a KPI tile and writes an audit line, but the mutation only
  knew about the jobs list. Matched on the key's second segment (`dashboard`,
  `analytics`, `audit-logs`) rather than by listing whole keys, so it cannot drift
  when a page asks for a different row limit.
- A query whose UI is closed now waits for it. `ScheduleDialog` is always rendered
  — the shortlist just passes it `open` — so it was reading
  `/company/interview-defaults` on a page where nobody had opened it.

## 9.2 Recording rebuilt onto `WSS /api/recordings/stream/{id}`

The backend retired the direct-to-cloud path. **Five endpoints deleted**:
`recordings/start-upload`, `recordings/upload-progress`, `recordings/finalize`,
`recordings/cancel`, `link-recording`. Sealing and linking are the server's own
work now, triggered by a `stop` frame.

`MediaRecorder` → one socket → the backend persists each chunk and **acks what is
safe**. Every chunk stays in memory until an ack covers it, and the ack carries a
byte total rather than a promise, so a dropped connection is repaired by
reconnecting, reading `resumeFrom`, and re-sending from exactly that offset. Two
details that are easy to get wrong, and were:

- a chunk **straddling** the resume boundary has its acked head sliced off, or
  those bytes appear twice inside the file;
- "sent" is one cursor, not a flag per chunk, because a resume *is* a rewind of
  that number.

⚠️ **The bug worth remembering: StrictMode poisons refs written during cleanup.**
The teardown effect set `finishingRef = true` so that closing the socket could not
schedule a reconnect into an unmounted page. React 19 mounts every effect twice on
the *same instance* — setup, cleanup, setup — and a ref survives that cleanup. The
page mounts long before the camera is granted, so the flag was already true when
recording began: the recorder ran, chunks piled up, `connect` returned at its first
line, and **no socket was ever opened**. The sitting then ended with the server
cancelling an empty recording, which is indistinguishable from never having tried.
Two sittings were lost to it before the cause was found. `start()` now re-arms the
flag; the old `use-live-publish` never had the bug because it scoped its guard to
the effect run, which is the pattern to copy.

Playback is keyed on the **interview**, not a recording session id:
`GET /api/recordings/by-interview/{id}/playback-url`. Its 404 is a normal answer
and is read as "no recording" — "there isn't one" and "you aren't allowed to watch
it" arrive identically, so that is the only wording true either way. This closes
§4.3 and §8.9.1: **recording and playback are verified working end to end.**

## 9.3 Live view v2 — WebRTC deleted

`signaling.ts`, `use-live-publish.ts` and `use-live-viewer.ts` are gone: **809
lines**. Public STUN with no TURN relay never formed a peer connection on a
corporate network, a VPN or symmetric NAT, and it neither errors nor connects — so
every recruiter on such a network saw "live view unavailable on this network" and
an empty page. It was never fixable from here.

`WSS /api/live-relay/{interview_id}` replaces it: the candidate's own recording
bytes, fanned out by the backend. If the candidate can sit the interview, live view
works. The cost is 1–3 seconds of delay, which is why nothing in the UI says
"real-time".

The player is a `MediaSource`. Four rules, each of which is a way it otherwise
breaks: appends serialised through a queue drained by `updateend`; the element
nudged to the live edge past 4s of drift, or a backgrounded tab falls minutes
behind; the buffer trimmed to 30s of played video, or an hour-long sitting is an
hour of video in the tab's memory; and a rebuild on `stream-reset` and on every
rejoin, because each begins with a fresh init segment.

⚠️ **`stream-offline` must NOT rebuild.** The candidate's client reconnects by
itself and the bytes resume where they stopped, so tearing down a working buffer
means waiting for an init segment that is not coming.

Also: `1013` ("you fell behind") says reconnect immediately, which taken literally
is a hot loop — a connection too slow to keep up is dropped again the moment it
catches up. Capped at three consecutive immediate rejoins, then backoff.

**Questions and answers came back, from the server this time.** They used to be
published by the candidate's browser over the peer connection's data channel, so
they died with the picture on exactly the networks where the picture died. They now
arrive as JSON `progress` snapshots on the same socket, which means they survive a
browser that cannot decode the stream at all. Full snapshot every time, so applying
one is an assignment rather than a merge, and a repeated frame changes nothing.

The candidate's tab now holds **exactly one media socket**. No `RTCPeerConnection`
per viewer, no ICE gathering, no second encode of the same camera — and the vitals
sampler stopped holding each reading in state for the data channel, which had been
re-rendering the whole sitting every three seconds for a value nobody read.

## 9.4 The container — two more WebSocket bugs, both found by running it

`proxy_read_timeout` on an upgraded connection is an **idle** timeout, not a
lifetime, and both sockets go quiet at times:

1. `/api/live/{id}` went quiet by design once ICE was through, so nginx closed it
   at 300s and neither end reconnected — a second, independent cause of the
   five-minutes-in failure, sitting behind Cloud Run's own timeout.
2. Then the relay arrived and **`live-relay/` does not match `live/`**, so the new
   viewer socket fell into the ordinary `/api` location and its 300s timeout. A
   recruiter who opened the page and waited five minutes for a candidate to begin
   was cut off and left reconnecting. The pattern is now
   `(?:live(?:-relay)?|recordings/stream)/` — and not `live.*`, so the group ends
   at a `/` and a future `/api/live-something` keeps the ordinary timeout.

`docker/api-proxy.conf` holds what the two `/api` locations share, so a header
added to one cannot be missing from the other. ⚠️ **It contains no `${...}`
deliberately** — `envsubst` only rewrites files under `templates/`, and a variable
written in a snippet reaches nginx as literal text, which is how this image once
failed to boot (§7.5.3). `resolver` and `$api_upstream` therefore live at `server`
level in the template.

**A verification method worth reusing.** The two locations differ only in their
timeouts, which are unobservable from outside — so to prove which one nginx picks,
tag them inside the running container with a temporary `add_header X-Route`,
`nginx -s reload`, curl each path and read the header back, then restore the
original config. It settled both bugs in a minute.

⚠️ **Everything in `public/` is image weight, not just repo weight.**
`recruiter.mp4` is 7.4 MB and took the image from 97.6 MB to **112 MB**. It also
ships on a `--source` deploy regardless of git, because `.gcloudignore` is
path-based and uploads the working directory.

## 9.5 Corrections, mostly visible ones

- **Situational questions show their scenario.** `scenario` was never parsed, so
  the psychometric rounds asked *"What do you do?"* with nothing to do it about. It
  renders above the question on the candidate's card, Elena **reads it aloud**
  before the options (a candidate answering by voice may never look at the card),
  it goes into the transcript and the recruiter's live panel, and the backend now
  returns it on `question_details[]` so the finished report has it too.
- **Submitting the interview says so**, on a card of its own — it seals the video
  and scores every answer, so it runs for seconds, and a button spinner left the
  room looking idle and still answerable. A per-*answer* card was built and then
  removed on request: thirty of them made a one-second round trip feel like an
  event.
- The **host orb is pinned** above the scroll area. It is the only indicator of
  whether Elena is still speaking, and scrolling a long scenario took it off screen
  at exactly the wrong moment.
- **Enter sends the selected option.** Gated on the *focused* option being the
  *selected* one, because Enter on a button always fires its click — so on an
  unselected option it must be left alone to do the selecting.
- **Paste and drop are refused in the open-answer box**, with a visible line saying
  so: a paste that silently does nothing reads as a broken field, and a candidate
  who thinks the page is broken reloads it and loses the sitting. Dictation is
  unaffected — it writes through `onAnswerChange`, not the clipboard.
- ⚠️ **The password eye icon jumped on press — the same trap as §7.4's Live Preview
  tab.** `Button` carries `active:translate-y-px` and the icon carried
  `-translate-y-1/2`; in Tailwind v4 both compile to the `translate` property, so
  pressing it *replaced* its own centring and the icon dropped half its height.
  Fixed on both auth forms by moving the positioning to a wrapper that centres with
  `inset-y-0` and a grid — no translate left to collide with.
- **The "R" square is gone** from the sidebar, the interview room and the login
  panel; the collapsed rail keeps a gradient logomark with the letter on it,
  because a 4rem rail cannot hold a wordmark and an empty slot reads as a missing
  image. `favicon.svg` still carries the R.
- **`create-interview` no longer claims no email was sent.** The reader defaulted
  the absent delivery flag to `false`, and the dialog stated that as fact while
  candidates were receiving their invitations. `emailSent` is now `boolean | null`
  and only an explicit `false` earns the warning. **Silence is not a denial** — the
  pattern is worth applying wherever a `?? false` reads a field the server may
  simply not send.
- **Landing page:** the hero's candidate tile played a 404 from
  `recruiterai.nugget.ai` (a `<source>` that fails does so silently — a black
  rectangle, nothing logged); and its "Active Modules" text was invisible in dark
  mode. That second one is structural and worth understanding: the marketing page
  is **light-only** — its own tokens are fixed values — but it builds those white
  surfaces out of the shared theme-aware `ui/` primitives, so
  `text-card-foreground` resolved to near-white on a permanently white card. Fixed
  by naming `.recruiter-landing` in the light-palette selector, and on
  `BrandDialog` too: ⚠️ **a dialog portals to `document.body`, so it sits outside
  the page that styles it.**
- The **Profile page** runs the full width like every other page.

## 9.6 Verified API behaviour (new this session)

| Fact | Evidence |
|---|---|
| `WSS /api/recordings/stream/{id}` is live and reaches its auth check | probe closed `4001 invalid token`, both direct and through the container |
| **`WSS /api/live-relay/{id}` was NOT deployed** as of 12 Aug | handshake refused, identical to a route that does not exist |
| `POST /api/create-interview`'s 200 is **`{}`** in `openapi.json` and carries no delivery field | fetched the live spec; §9.5's `emailSent` fix follows from it |
| `get-results → question_details[]` now carries **`scenario`** | backend handoff of 12 Aug, shipped with the progress frames |
| **There is no text-to-speech endpoint.** All three speech routes are speech→**text** | 73 paths in the live spec; not one declares an `audio/*` response |
| `POST /api/speech-to-text/upload` exists (multipart) and **we do not use it** | base64 inflates the payload ~33%; the fallback still posts base64 |
| A WebSocket route is invisible to `openapi.json` **and** a nonexistent path refuses the handshake identically | which is why the relay had to be probed rather than looked up |

## 9.7 Open issues

1. **The relay and its `progress` frames need the backend deploy.** The client is
   complete; until then the live page reads "Reconnecting to the live feed…" and
   retries, and lights up on its own when the backend ships.
2. **Nothing else reports progress mid-sitting.** `get-results` is null until
   finish and the interviews row carries only `answered`.
   `BACKEND-REQUEST-live-progress.md` (repo root, uncommitted) is the written ask;
   the backend has since implemented it as `progress` frames, so that document is
   now a record rather than a request.
3. **Fullscreen exits still have no carrier field** (§8.9.2, unchanged).
4. **Cloud Run `SIGTERM` → nginx fast shutdown** (§7.6.4, unchanged). Deliberately
   not attempted before a deploy: it needs an entrypoint wrapper, and the last
   script added to this image failed on a lost execute bit.
5. **`README.md` is still the stock template** (§8.9.4, unchanged).
6. **The landing page's Request Access form posts nowhere** — `onSubmit` only sets
   a success state. Worth knowing before anyone measures conversions on it (a Meta
   Pixel was discussed and deliberately not added; if it ever is, keep it on `/`
   only — interview URLs carry the candidate's email in the query string).
7. ⚠️ **Files keep vanishing from the working tree.** `public/favicon.svg` and
   `LIVE-VIEW-FRONTEND-GUIDE.md` were both found deleted, unasked — the same shape
   as §7.6's root `.md` files and `docker/` disappearing twice. Tracked files go,
   `src/` is untouched. `favicon.svg` was restored (`index.html` links it, so the
   tab icon had been 404ing); the guide's deletion is still unstaged. Find the
   culprit before it takes something uncommitted.
8. **Uncommitted at session end**, deliberately: §9.5's interview-room, auth,
   dashboard-layout and `emailSent` changes; `BACKEND-REQUEST-live-progress.md`;
   this file. `src/recruiter-landing-page/sections.tsx` shows a diff that is
   **trailing whitespace only**.

## 9.8 What §7 and §8 now get wrong

Read those sections with this list beside them:

- **§3's recording bullet** describes `start-upload` → `PUT` → `finalize` →
  `link-recording`. All five endpoints are deleted; see §9.2.
- **§4.3 and §8.9.1** — "no recording id, playback dead". Solved: playback is keyed
  on the interview id and is verified working.
- **§7.6.3, §7.7 and §8.10** — live viewing over WebRTC, its TURN problem and its
  unproven state. That whole path is deleted; see §9.3.
- **§8.6's nine-file split** was documented as done in session 3 but had never been
  committed — `a6dcec0` still held the 1,249-line original. It went out in
  `ab0c611` this session.
- **§8.5's rPPG note still stands**, and so does everything in §8.1–§8.4.

## 9.9 Not verified — treat as unproven

- **Live video and the `progress` frames.** Parsing is verified against the
  backend's documented payload and its stated edge cases (13 checks), never against
  a live frame. Nothing has been watched.
- **`scenario` on the finished report** — needs a sitting that ran *after* the
  backend's deploy; older records have none stored.
- **The recording resume path.** Verified by construction, and one full sitting
  recorded and played back — but no real mid-sitting drop has been observed, so
  `resumeFrom` has never actually been exercised.
- **The paste block, Enter-to-send and the pinned orb** at runtime. There is no
  browser automation in this project; they are verified by structure and a clean
  build only.
- **`video/mp4` recording on Safari**, and therefore whether a Safari sitting can be
  watched live at all (the player is pinned to `vp8,opus`).

## 9.10 Continuation prompt

Supersedes §8.11. Paste into a fresh session:

> I'm continuing work on the RecruiterAI frontend at `d:\RecruiterAi` (repo
> `abhinash-23/RecruiterAi` branch `main`, also `Citimedia/RecruiterAI-FrontEnd`
> branch `superadmin-admin-hr`; both at `0ced335`). Deployed to Cloud Run in
> `us-east4`; the backend is
> `https://recruiterai-backend-610993990979.us-east4.run.app`.
>
> Read `SESSION-HANDOVER.md` first, and read **§9.8 before §7 or §8** — it lists
> what those two sections now get wrong, because live viewing and recording were
> both re-pointed at new backend contracts in session 4. §9.6 and §2 are live API
> behaviours that contradict the docs; §9.7 the open issues; §9.9 what is unproven.
> `API-DOCUMENTATION 2.md` is far behind — trust a live payload, and remember that
> a WebSocket route cannot be confirmed from `openapi.json` at all.
>
> Conventions: comments explain *why* not *what*; services own all
> snake_case↔camelCase mapping and return camelCase domain objects; pages talk to
> hooks, not service functions; role-gated queries take an `enabled` flag, and so
> does a query whose dialog is closed; Actions columns use icon buttons via
> `components/shared/icon-action.tsx`. Reads happen on **mount and invalidation
> only** — no polling except the three timers named in §9.1.
>
> Two traps that have each cost a sitting: a ref written during effect cleanup
> survives StrictMode's double mount (§9.2), and `Button`'s `active:translate-y-px`
> replaces any `-translate-y-1/2` on the same element (§9.5).
>
> Verify with `npm run build` and `npx eslint .` — both clean at `0ced335`. If you
> touch the container, **build it, run it, and read the rendered
> `/etc/nginx/conf.d/default.conf`**; to prove which `location` handles a path, use
> the header-tagging trick in §9.4.
>
> Next task: <describe what you want>

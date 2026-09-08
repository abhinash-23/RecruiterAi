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
- **§10** — session 5, `0ced335` → `f15c653`: the Results recruiter filter, the
  super admin's client table, and a settings payload that was rendering as one
  value. ⚠️ **§10.1 accounts for fourteen commits from other sessions that are
  not written up, and corrects two of §9's open issues.** §10.4 is worth reading
  before trusting any "uncommitted" list in here.
- **§11** — session 6, `f15c653` → `eeb538c`: the live interview page rebuilt as a
  monitoring console, a selection threshold per job, self-service password reset,
  and the sitting’s clock moved onto the server’s deadline. ⚠️ **§11.3 is a bug that
  made every one-time code field in the app unusable**, and §11.10 records a third
  round of files being changed from outside the session.
- **§12** — session 7, `eeb538c` → **uncommitted**: the **voice interview** —
  the candidate talks to an AI host over `WS /api/voice/{session_id}` while the
  backend transcribes, matches, submits and scores. Seven new files, eight
  edited, zero commits. Four live sittings have now run, finding five bugs that
  code review had missed — including an `end` frame that was **closing live
  interviews** (§12.16) and, on the rev-6 flow, **this client overriding Elena's
  tool calls with its own end-of-speech detection**, which recorded a declined
  rating question as *Neutral* (§12.21). ⚠️ **Read §12.21 and §12.19 before
  §12.11 or §12.12**, which are the oldest sections and the most wrong:
  §12.14–§12.21 correct them piece by piece. §12.19 is the backend's **v7.1
  brief, protocol `rev: 6`** — the contract, superseding every earlier brief
  this file cites; §12.21 is what a live sitting then did to it. §12.22 finally
  renders the spoken `introduction` in the recruiter's report, which three
  earlier sections had logged as owned by nobody. The check-in is still
  **unproven** (§12.24). §12.23 is four faults found by watching somebody sit
  the interview, one of which — Elena reading questions at a candidate whose
  camera cannot see them — is only half fixable from this side.

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
  `npx eslint .`. Both pass as of `f15c653`. Session 1 used narrower commands;
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
- **Results has a Recruiters dropdown**, and a "Scheduled by" column beside it — a
  filter over an attribute you cannot see is hard to trust. Both are admin-only,
  because HR sees only their own candidates and the dropdown would have one entry.
  The logic moved into `features/dashboard/interview-scheduler.ts` and the
  Interviews list was moved onto it rather than the twenty lines being copied: the
  two pages read the same `GET /api/interviews` rows and have to agree on the
  `__system__` sentinel for `createdBy: null` and on the wording "System / API",
  or the same recruiter appears under two names and one page's filter silently
  matches rows the other's does not. Options are built from **the rows on screen**,
  never from `GET /api/company/hrs`, so a seat that has scheduled nothing cannot
  sit in the list filtering the table to empty.

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
   **trailing whitespace only**. Added late in the same session and also
   uncommitted: the Results recruiter filter with
   `features/dashboard/interview-scheduler.ts`, and
   `BACKEND-REQUEST-tab-close.md`. `LIVE-VIEW-FRONTEND-GUIDE.md` is still showing
   as deleted (item 7) and that deletion is deliberately unstaged.

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

## 9.10 A closed tab still destroys the sitting

Investigated, written up for the backend team as `BACKEND-REQUEST-tab-close.md`
(repo root, uncommitted), and **not fixable from here** — recorded because it is
the largest remaining hole in the product and the reasoning took a while to
assemble.

On `pagehide` the candidate's page fires `navigator.sendBeacon` at
`POST /api/interview-closed`, which per §8.5 and §11 of the API doc **marks the
interview abandoned**. Two things are then lost that the server already holds:

1. **The report.** `get-results` returns `results: null` until an interview is
   *finished*, and an abandoned one never is. But every answer given was already
   submitted **and scored** by `POST /api/submit-answer`, which returns a score and
   feedback per answer. So a candidate who answered 22 of 30 and closed the tab
   leaves a red *Abandoned* badge and a blank report, with 22 scores sitting in the
   database. This is the same failure §3 records for the old *End interview*
   button, which we fixed by calling `finish-interview` instead — an option a closed
   tab does not have, because nothing runs after the tab is gone.
2. **The candidate.** `POST /api/verify-otp` answers **409 "already started in
   another tab (one sitting per link, enforced atomically)"**, so reopening the link
   after a crash or a sleeping laptop is refused. Unrecoverable for them and for the
   recruiter — a support ticket and a re-invitation every time.

⚠️ **`pagehide` is not "closed".** It fires when a tab is backgrounded on mobile
Safari, when a phone locks its screen, and when a page enters the back/forward
cache. Treating the first beacon as abandonment is too eager, and is almost
certainly marking candidates abandoned who never left. The right shape is for the
beacon to record "the client went quiet at T" and let the existing
`sweep-abandoned` cron decide, since the page already heartbeats every 30s.

⚠️ **`/api/interview-closed` is unauthenticated.** The doc justifies it with
"beacons can't set headers" — true of headers, but a beacon carries a **body**, and
we hold the candidate token. As it stands, anyone who learns a `session_id` can end
someone else's interview with one unauthenticated POST. We offered to send the token
in the body the moment they accept it; it is two lines here.

Worth repeating to them: **the frontend cost of the fixes is near zero.** The report
page already renders `results` whenever it is non-null, so scoring a partial sitting
would simply start showing them. A resume flow needs only `next_index` and — this
part matters — a server-side `seconds_left`, because the countdown lives in the tab
and dies with it, so without it a reload buys the candidate a fresh 30 minutes.

## 9.11 Continuation prompt

Supersedes §8.11. Paste into a fresh session:

> I'm continuing work on the RecruiterAI frontend at `d:\RecruiterAi` (repo
> `abhinash-23/RecruiterAi` branch `main`, also `Citimedia/RecruiterAI-FrontEnd`
> branch `superadmin-admin-hr`; both at `f15c653`). Deployed to Cloud Run in
> `us-east4`; the backend is
> `https://recruiterai-backend-610993990979.us-east4.run.app`.
>
> Read `SESSION-HANDOVER.md` first — **§10 is the newest section, and §10.1
> corrects two of §9's open issues** — and read **§9.8 before §7 or §8** — it lists
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
> Verify with `npm run build` and `npx eslint .` — both clean at `f15c653`. If you
> touch the container, **build it, run it, and read the rendered
> `/etc/nginx/conf.d/default.conf`**; to prove which `location` handles a path, use
> the header-tagging trick in §9.4.
>
> Next task: <describe what you want>

---

# 10. Session 5 — `0ced335` → `f15c653`

Four commits here. **Fourteen more landed in between, from other sessions**, and
they are not written up — §10.1 lists them so the range is at least accounted for.

```
5d10ef3  feat: filter results by the recruiter who scheduled them
411140b  feat: the super admin's dashboard shows every client
0bed67a  fix: platform settings rendered as a single value
f15c653  chore: drop the aptitude round from the interview options
```

Both remotes are at `f15c653`. `npm run build` and `npx eslint .` are clean on
that tree, including the changes described in §10.2 that were not authored here.

---

## 10.1 What arrived between §9 and this section

Not authored or reviewed in this session — recorded because the handover would
otherwise have a fourteen-commit hole in it, and because two of §9's open issues
were closed by them:

```
Aug 14  a3c0967  fix: one field per row in every create/edit dialog
Aug 14  60e9d45  fix: show the send buttons on an expired row, disabled
Aug 14  706b79c  feat: interview integrity on the report page, not behind a tab
Aug 14  7cbaf40  fix: stop the dashboard's interview list padding itself with empty space
Aug 14  fc3ae38  feat: the access code as one box per digit, with a resend cooldown
Aug 14  3ad864e  feat: Meta Pixel, on the landing page and nowhere else
Aug 14  b0afb81  fix: drop the lettered square from the wordmark, and stop the eye jumping
Aug 14  64fd594  docs: session notes, and the live-progress request to the backend
Aug 14  646a82b  fix: let the candidate paste their access code
Aug 14  a861eba  feat: the host's orb as a plasma sphere in the brand's own colours
Aug 14  062e127  fix: keep the question's number on screen while the options scroll
Aug 14  d4c3fd9  fix: hold the sidebar's account name against the left edge
Aug 17  59a7652  fix: centre the access code boxes
Aug 17  0015eaf  feat: the host's orb as a breathing sphere with colour under the surface
```

**Two corrections to §9 follow from them:**

- **§9.7 item 8's uncommitted list is resolved.** The interview-room, auth and
  `emailSent` changes went out in `b0afb81`; the §9 write-up and
  `BACKEND-REQUEST-live-progress.md` in `64fd594`. Read that item as history.
- **§9.7 item 6 is out of date.** It records the Meta Pixel as discussed and
  deliberately not added. It *was* added, in `3ad864e`, as `src/lib/pixel.ts` —
  and correctly: it is imported only by the landing page's own components, so it
  cannot fire on `/otp?…email=…` or anywhere in the console. Its header gives the
  same reason we did — a pixel in the shared `index.html` reports
  `document.location` on every route, which would send candidate names and email
  addresses to Meta from a product whose trust page advertises a GDPR DPA. The
  `<noscript>` half is deliberately omitted: it can only live in that shared
  `index.html`, and in a client-rendered SPA the only thing it could measure is
  crawlers. The pixel id is hardcoded rather than an env var.

## 10.2 What this session did

**The Results page filters by recruiter** (`5d10ef3`) — documented as a bullet in
§9.5, since the work belongs with that batch.

**Three commits were work already sitting uncommitted in the tree**, about 480
lines, not authored here. They were read, split by concern and committed rather
than swept into one:

- `411140b` — the super admin's Clients table: every tenant, busiest first, with
  interview volume, completion rate and seat count, and a "Shared data" badge on
  any tenant whose `tenancyEnforced` is false. Plus the sitting-rates card lifted
  so both dashboards render one copy, and an optional second line on stat tiles.
- `0bed67a` — **a real API finding**: `GET /api/settings` nests the entire store
  under a `settings` key, so after dropping the envelope's `status` what was left
  was one key holding everything, and the page rendered it as a single setting.
  Unwrapped in the service where the mapping belongs, guarded so an envelope that
  ever inlines its keys still works.
- `f15c653` — `"aptitude"` out of `INTERVIEW_ROUND_OPTIONS`, so the New interview
  and Schedule dialogs no longer offer that round.

⚠️ **Those three messages describe what the diffs do, not why.** They were written
from the code, not from the intent behind it — worth a read if the wording matters.

## 10.3 Open questions

1. ⚠️ **`aptitude` is commented out, not deleted, and no reason is recorded.** The
   line above it still reads "Rounds an interview can be built from. Anything else
   is a 422", which reads as though aptitude were valid. If the backend rejects
   it, say so there; if it is temporary, say that instead. Six months from now
   somebody will uncomment it.
2. **`BACKEND-REQUEST-tab-close.md` is unanswered** (§9.10). Nothing has changed
   in the tab-close behaviour: a closed tab still marks the sitting abandoned,
   still discards a report the server could assemble from answers it has already
   scored, and still locks the candidate out with a 409.
3. **Still uncommitted:** `SESSION-HANDOVER.md` and
   `BACKEND-REQUEST-tab-close.md`, both by request.

## 10.4 Read the repo before trusting this file

Recorded as a process note, because it cost real time here. This session began
from a picture of the repo that was fourteen commits stale — `0ced335` as HEAD
when it was actually `0015eaf` — and the gap only surfaced when a text anchor in
this file failed to match. Three of §9's statements about uncommitted work were
wrong by then.

Before trusting any "uncommitted at session end" list, run `git log --oneline -8`
and `git status`. This file records a moment; other sessions commit in between,
and they do not always write themselves up.

Two smaller traps in the same vein, both hit while editing this file:
`SESSION-HANDOVER.md` is **CRLF** on disk, and this shell mangles `§` and other
non-ASCII inside a heredoc — so patch it with ASCII-only anchors, or write the new
text to a file and splice it.

# 11. Session 6 — `f15c653` → `eeb538c`

Thirteen commits, all authored here, all pushed to **both** remotes:
`origin/main` and `company/superadmin-admin-hr`.

```
56f4420  docs: session 5 handover and the tab-close backend request
f55b272  feat: the live interview screen as a monitoring console
5905998  fix: Enter submits a one-time code
22d1d9e  feat: time up ends the sitting
d95374a  feat: self-service password reset for staff
87c0688  feat: a selection threshold per job
02491a9  refactor: one email rule and one score-tone
eb0b345  fix: a one-time code field that accepts a whole code
ebf215c  feat: a spent reset code says so, and resend never waits
d92a1e1  feat: Enter sends an open answer
9587bea  docs: ask the backend to enforce the interview time limit
b1ac574  chore: switch off the notification bell
eeb538c  feat: the sitting's clock is the server's
```

`npx tsc -b`, `npx eslint .` and `npx vite build` are all clean at `eeb538c`,
and that tree also **builds and serves as a Docker image** (11.9).

⚠️ **The company remote has a `main` branch in its history that should not
exist.** It was created here by a `git push company main` before it was clear
that repo's branches are `dev` (default), `dev-superadmin` and
`superadmin-admin-hr`, and deleted again in the same session. If a stale local
ref or a fork shows `main` on `Citimedia/RecruiterAI-FrontEnd`, that is why.

---

## 11.1 The live interview page, rebuilt three times

Started as three equal columns (vitals | candidate | conversation) and ended as
two regions. Both intermediate shapes were wrong for reasons worth keeping,
because they are properties of the components rather than of taste:

1. **Three thirds is unreadable, and the cause is a container query.**
   `VitalsPanel` is a grid sized by `@container`, so in a 440px third it drops to
   **one tile per row** — six tiles and a dozen blood markers ran to some two
   thousand pixels beside a video squeezed into a third of the width. That is
   where all the empty space came from, not from spacing.
2. **2/3 + 1/3 fixed the video and not the hole.** The readings still ran longer
   than a 16:9 video ever can, so one column always ended first.

What shipped: **video and the vitals *readings* side by side at 3/5 and 2/5**,
the readings told to fill the height the video sets (`auto-rows-fr`, so the tiles
stretch and there is nothing to scroll), and the **blood markers moved to a
full-width card of their own**, where a dozen label/value pairs read as a
three-column table instead of a queue. Below that, the conversation: the current
question full width, then the answers.

`VitalsPanel` takes a `section` prop (`"all" | "readings" | "markers"`) for that
split. The report page passes nothing and is unchanged.

**Answers are grouped into their rounds**, one fold per round, the round the
candidate is on open and the rest a click away. The round name used to be printed
on all thirty cards — the same word down the column, saying nothing about any one
answer.

⚠️ **The folds are a button and a panel, not `<details>`.** `<details>` was the
obvious choice and is why the first version snapped open: a browser shows and
hides its content itself, from a state CSS cannot transition, so there is no
in-between for a duration to apply to. `::details-content` will eventually make
that animatable and only Chromium implements it today. The panel is a one-row
grid whose track runs `0fr` → `1fr` — that *is* interpolable everywhere — with
the content clipped inside it. The clip has to be its own element, or the rows
reflow as it opens instead of being revealed.

The player lost its native `controls`: they drew a seek bar over a stream that
cannot be seeked (the buffer holds the last 30 seconds and the element is nudged
back to the live edge whenever it drifts), so every control on it either did
nothing or fought the player. Sound and fullscreen are the two that do something.

Also fixed here: the mute toggle only re-applied when pressed, but the relay sets
`video.muted = true` itself whenever it rebuilds the player on a stream reset —
so after a reset the button read "Mute" over a silent feed.

## 11.2 The bug that blanked the whole app

Worth its own section because the failure mode is invisible in review and fatal
at runtime. The first version of the round accordion did this:

```tsx
onToggle={(event) =>
  setOpenOverride((current) => ({ ...current, [key]: event.currentTarget.open }))
}
```

React nulls `event.currentTarget` as soon as the handler returns, and a state
**updater runs later, in the render phase**. So it read `.open` off `null` and
threw — and a render-phase throw in this app has no error boundary to catch it,
so React unmounted the entire tree. Sidebar and all: a blank page.

It crashed on load rather than on a click, because **setting `open` on a
`<details>` queues a `toggle` event of its own** — the open fold fired one at
mount, before anyone touched anything.

Two rules follow, and neither is specific to that component:

- **Read from an event before calling a setter, never inside the updater.**
- **This app has no error boundary**, so any render-phase throw is a white
  screen. Worth adding one; not done here.

## 11.3 The one-time code field never worked

`OtpInput` — the shared component behind both the candidate's interview code and
the staff password reset — could not accept more than one digit. It had been that
way since it was written (§10.1, `fc3ae38`).

`write` handed the new value up and moved the caret in the same synchronous
breath, **before React re-rendered**, so the box it focused still held the
previous render's props. Its `onFocus` read the stale value, decided the box was
past the end of a code that had already grown, and threw focus back where it came
from. The digit landed; the caret did not move. Every keystroke after that
re-entered box one, and `write` truncates at the index it is given — so a
six-digit code could never be longer than one digit. Paste failed the same way:
the value was set correctly, then the caret bounced.

Fixed with a ref holding the value as of the last **write**, set before the focus
move, so the receiving box judges itself against the code as it is now.

**Enter was separately broken, and the comment claimed it worked.** The `<form>`
was there, but a browser skips implicit submission when a form holds more than
one field that blocks it *and* has no submit button of its own — a code field is
six such fields, and Verify sits in the card footer, outside the form. The boxes
now call `form.requestSubmit()`.

## 11.4 A selection threshold per job

Every interview was judged against a hardcoded 75. The bar is now per job, or per
individually created interview, with 75 still the answer when nothing sets one.

**Two backend deltas arrived on the same day**, so read the endpoint notes in
`services/hr/jobs.ts` and `services/hr/interviews.ts` rather than any handoff:

- The bar is **frozen onto each interview at creation**, so editing a job reaches
  only interviews scheduled afterwards and no delivered verdict moves. That is
  why the results view reads the threshold from the *report*, not from the job.
- **Two nulls that mean different things.** On a **job**, `null` means "no bar of
  its own" and renders as "75% (default)". On an **interview**, the server sends
  the already-resolved number — before the sitting finishes, and for sittings
  scored before thresholds existed, where the top-level field correctly reports
  the 75 that judged them while the stored `results` object has no threshold at
  all. Bind to the **top-level** `selection_threshold_pct`, not the nested one.
- **PATCH `null` clears it.** The first handoff said to send `75`; the delta
  replaced that. Sending 75 pins a literal 75 as the job's own choice, so the job
  stops following the platform default. Emptying the field on the edit form is
  the reset.

`field-schema` could not express an **optional number**: `z.coerce.number()`
reads `""` as 0, so an empty box failed its own minimum before anyone touched it.
Optional numbers now accept `""` and start empty. No existing field used the kind.

## 11.5 Self-service password reset, and its delta

`POST /api/auth/forgot-password` → 6-digit code → `.../confirm`. Staff only; a
candidate has no password, and their `verify-otp` code is a different,
domain-separated scheme.

The security property lives in the copy: the request endpoint answers
**identically** for an address with an account, one that is disabled and one that
never existed, so the screen advances to the code step every time and never
reports whether anything was sent. `RESET_CODE_SENT_MESSAGE` is defined beside
the call for that reason — so it cannot later be "improved" into "email not
found".

The delta added a **second, distinct 400**: *"This code was already used."*
Told apart by the message (`isSpentResetCode`), because it asks for a different
reaction — it is not a failed guess, it does **not** count toward the six-attempt
lockout, and it leaves the digits alone where the generic case clears them.

**Resend has no cooldown.** It had a minute's, on the reasoning that the endpoint
allows three sends per ten minutes. Removed by request, and the reasoning holds
either way: the press people actually make is the one where the first email has
not arrived, and a minute of a disabled link with a countdown on it is a minute
of being told to wait by a screen that cannot know. The 429 is handled where it
happens and says how long to leave it.

## 11.6 Time up — asked for, and answered the same day

`BACKEND-REQUEST-time-up.md` went out and **the backend shipped all five asks**
before the session ended. Both halves are in:

- **Frontend, before the backend:** `useCountdown` gained an `onElapsed` that
  calls `finishSitting` — the same path the last question uses, not the
  `interview-closed` abandonment path, which discards answers the server has
  already scored. Until then the timer simply sat at `00:00` and the candidate
  carried on answering, so the limit was a display.
- **After:** the clock counts down to `expires_at` (`deadline - now`), so it
  cannot drift, a throttled background tab cannot slow it, a sleeping machine
  cannot stop it, and a reload shows the right number.
- `submit-answer` and `submit-answer-voice` answer **409 `time_up`** past the
  deadline, and by then the sitting is already finished and scored. Handled in
  the page's `run` helper rather than at the call site, because every
  candidate-side request passes through it — including the spoken answer, which
  is submitted from inside `useVoiceAnswers` and would otherwise have reported
  the refusal as a broken microphone.
- `heartbeat` returns `reason: "time_up"`, which picks the closing screen. A
  sitting the clock ended was submitted and scored; the generic "session closed"
  screen would send that candidate to their recruiter over a fault that is not
  one.

`ApiError` now carries the body's **`code`**, and `isTimeUp` branches on that
rather than on the 409 — a status is shared, and another conflict reaching the
same call would otherwise be reported to a candidate as their time running out.

⚠️ **The off-camera hold is gone wherever `expires_at` is sent.** The local clock
used to pause while the candidate was off camera so a slipped webcam cost them
nothing. The server's deadline does **not** pause. A display that holds while the
real clock runs shows time the candidate does not have and then refuses their
next answer, so `paused` now applies only to the no-`expires_at` fallback. **If
that grace was policy rather than kindness, it needs the backend to pause too** —
freezing the display cannot buy back time the server has already spent.

## 11.7 Duplication removed, and what was left

Two helpers were duplicated with differences nobody had recorded a reason for:

- **Email, checked three ways.** Candidate intake used `/^\S+@\S+\.\S+$/`, and
  `\S` matches `@` — so `a@@b.com` passed there and was refused by every
  generated form. That mattered on intake in particular: a malformed address is a
  *schema* failure, so the server answers 422 and creates nothing, which is the
  exact outcome the dialog's own check exists to prevent. `lib/email.ts`
  delegates to the same Zod `.email()` that `schemaFromFields` generates.
- **`scoreTone`, defined four times**, and the bottom band differed: red on three
  pages, grey on the shortlist. The grey was *right* — a low **fit** score is a
  weak match on a candidate nobody has judged yet, and red would be that table
  returning a verdict of its own — but nothing said so, so it read as drift. It
  is now an argument (`"poor"` / `"weak"`).

Deliberately **not** deduplicated: `toUtcIso` (five copies of a one-line function
that will never change), `asNumber`/`num`, and `PasswordField` (each typed to its
own form's values). The `isSelected` check in `session.ts` duplicates
`isSelectedResult` in `hr/interviews.ts`, but the `session.ts` copy is **dead** —
`toInterviewSummary` is only reached by `finishInterview`, whose return value the
candidate page discards by design.

Number inputs lost their spinner and their scroll-wheel behaviour, in
`ui/input.tsx` so it lands once: a focused `type="number"` treats a scroll as a
step, so scrolling the page with the cursor over a field silently rewrote what
was typed, on a form submitted moments later.

## 11.8 Enter sends an open answer

In the interview room, Enter submits and **Shift+Enter** starts a new line. The
guards are the Send button's own, plus one it does not need: nothing happens
while dictation is writing into the box — it is `readOnly` then because it is not
the candidate's to type in, so it is not theirs to submit from either.

## 11.9 The Docker image, verified rather than assumed

`docker build` and a running container, both clean, **no Dockerfile change
needed**. 112 MB (was 97 MB in §7.5), `linux/amd64`, uid 101.

What was actually probed, because a green build proves less than it looks:

| Check | Result |
|---|---|
| `GET /` and `GET /admin/jobs` | 200 — SPA fallback intact |
| **`.mjs` PDF worker** | `application/javascript` — the `mime.types` `sed` still matches nginx 1.27-alpine |
| `POST /api/auth/login` via the proxy | **401 from the real backend** — so `API_PROXY_TARGET` and per-request resolution both work |
| Security headers | present, camera/mic `self` |
| User / health | `uid=101(nginx)`, `HEALTHCHECK` healthy |
| `.env` | not in the image |

Docker Desktop is installed at `AppData\Local\Programs\DockerDesktop`, not under
`Program Files` — `Test-Path` on the usual path says False.

## 11.10 Something outside the session is editing this repo

Third occurrence, and §9.7 recorded the first:

- `BACKEND-REQUEST-live-progress.md` and `BACKEND-REQUEST-tab-close.md` were
  **deleted from the working tree, unasked** — the second of those twice, after
  being committed here in `56f4420`.
- The `/* ===== */` banner rules were stripped from the section headings of
  `services/admin/company.ts` and `services/interview/session.ts`, each time
  while that file was being edited. Only the lines matching `^/\* =+ \*/$`, with
  the heading text left in place.

**It is not a formatter and not a git hook**: there is no husky, no lint-staged,
no pre-commit hook, and Prettier never deletes comment lines (confirmed — it
still reports `jobs.ts`, which keeps its banners, as merely needing formatting).
Replacing exactly those lines is a targeted edit. Most likely an IDE extension or
a second agent with write access to the folder. The comments are free to lose;
the documents are not.

## 11.11 Open issues

1. ⚠️ **The off-camera pause is now a product question**, not an implementation
   detail — see 11.6.
2. **No error boundary.** Any render-phase throw blanks the whole app (11.2).
3. **`BACKEND-REQUEST-tab-close.md` is still unanswered** — and now deleted from
   the tree. §9.10 stands.
4. **The frontend deployment is stale.** `recruiterai.nugget.ai` was serving a
   build without the time-up submit while that was already committed. Rebuild
   before testing candidate-side behaviour against it.
5. **Still uncommitted, by request:** the two deleted `BACKEND-REQUEST-*.md`
   files. Committing a deletion of docs nobody asked to delete needs a word
   first; `git restore` on those two paths brings them back.
6. **`navigation.ts` and `router.tsx` are two files that must agree.** The
   config's docstring calls itself "the single source for both the sidebar and
   the route table" — it is not. Adding a page means editing both.

## 11.12 Process notes, all of them mistakes made here

- **`perl -0pi -e 's|…|…|'` with `\|` in the pattern mangled two files.** The
  pipe was both the delimiter and an escaped literal. Use the Edit tool, or a
  delimiter the pattern cannot contain.
- **`git checkout --` on a file with someone else's uncommitted change loses it.**
  Done here to undo a botched script; the one-line change was restored from the
  diff, but only because it was still on screen.
- **A line-number-based insert shifted the region a later edit targeted**, leaving
  an unterminated JSDoc. Anchor on text, not on line numbers.
- The §10.4 warnings held: this file is **CRLF**, and `§` does not survive a
  heredoc in this shell. Write the new section to a file and splice it.

---

# 12. Session 7 — `32ea410` → uncommitted

**Zero commits.** Everything below is in the working tree, held there by request
("don't push the code until I say"). `npx tsc -b --force`, `npx eslint src` and
`npm run build` are all clean as it stands.

```
new   src/services/interview/voice-socket.ts        the protocol
new   src/features/interview/pcm-capture-worklet.js mic → 16 kHz Int16
new   src/features/interview/voice-audio.ts         capture, playback, the mixer
new   src/features/interview/use-voice-interview.ts the socket and the turn-taking
new   src/features/interview/voice-room.tsx         the spoken room
new   src/features/interview/room-chrome.tsx        what both rooms share
new   src/features/interview/room-format.ts         `formatClock`, `OPTION_LETTERS`
new   BACKEND-REQUEST-voice.md                      nine asks, answered, plus three open
edit  src/services/interview/session.ts            `voiceMode`, `isAlreadyAnswered`
edit  src/features/interview/candidate-interview-page.tsx
edit  src/features/interview/interview-room.tsx     chrome lifted out
edit  src/features/interview/use-media-stream.ts    explicit echo cancellation
edit  src/features/interview/use-recording.ts       `mixAudio`, `addAudioTrack`
edit  src/services/hr/interviews.ts, jobs.ts        `voice_mode` on create
edit  src/features/dashboard/new-interview-dialog.tsx, pages/jobs-page.tsx
edit  docker/nginx.conf.template                    `/api/voice/…` is a socket route
```

The feature is the **voice interview**: the candidate talks to an AI host,
"Elena", who asks every question aloud over `WS /api/voice/{session_id}`, while
the backend does the transcribing, the option-matching, the submitting and the
scoring. Built from the backend team's brief of 2026-08-26, then reworked against
their **v2** brief of 2026-08-27, which answered all nine integration points
raised from the first live runs.

⚠️ **Nothing here has been verified against a live socket from this machine.**
The protocol handling is logic and holds up; the audio thresholds and barge-in are
physics and timing, and they need the mic test the backend team is also asking
for. Read §12.12 before trusting any number in this section.

---

## 12.1 Two rooms, one stage machine

`voice_mode` on `verify-otp` decides which interview the candidate sits. The
stage machine — code → consent → camera → sitting → done — is **identical either
way**; only the room differs, and everything around it (the clock, the recording,
vitals, the heartbeat, `finish-interview`, the time limit) is untouched.

- [`voice-room.tsx`](src/features/interview/voice-room.tsx) is deliberately the
  typed room to the pixel: same top bar, same camera pane, same three columns.
  A candidate moved between them mid-interview should not notice the screen
  change under them. That was tried as a chat layout at one point and reverted on
  request — the reversion is why `voice-conversation.tsx` does not exist.
- [`room-chrome.tsx`](src/features/interview/room-chrome.tsx) holds what both
  use (`RoomTopBar`, `CameraPane`), and
  [`room-format.ts`](src/features/interview/room-format.ts) the two literals
  (`formatClock`, `OPTION_LETTERS`). The split is not tidiness: a module that
  exports both a component and a plain function opts the whole file out of Fast
  Refresh, and the file in question renders a live interview.

**`spoken` only ever turns off.** It is seeded from the flag and cleared by a
microphone that wouldn't open, a socket that refused, or a drop that outlived the
reconnect budget. Nothing turns it back on mid-sitting — a candidate mid-answer is
the worst possible moment to change how answering works.

**A handover is not a restart.** `VoiceHandover.resumeAt` is the first unanswered
question, matched by `questionIndex` rather than used as a list position, and the
socket's captions are carried into the typed room's transcript. Two bugs were
found here the hard way; see §12.8.

## 12.2 The protocol layer

[`voice-socket.ts`](src/services/interview/voice-socket.ts) is to the voice socket
what `recording-socket.ts` is to the video one: the only place that builds the URL
or writes a frame. Every field is read under **both spellings** — the briefs
document camelCase, the backend is FastAPI and serves snake_case everywhere else,
and this app has been caught by that gap repeatedly (§9.5).

Three things in there worth not re-deriving:

- **`choice` is read with `null` preserved.** Null is a *value* — it is how a
  free-text answer says "there was no option to resolve to". Folding it in with
  absent makes a text answer indistinguishable from an old deployment.
- **`voiceCloseAction`** maps a close code to one of four outcomes, and `4408`
  (time up) is its own: the answers are scored, so it ends on the "your time ran
  out" screen and not in the typed room, which would offer time that no longer
  exists.
- **`VOICE_TERMINAL_CLOSE_CODES`** is the no-retry list: `4001`, `4403`, `4404`,
  `4408`, `4409`, `4503`, `1011`. Everything else is a transport drop worth
  another connection.

## 12.3 Audio — the worklet, and the two rules that are not obvious

Capture is an `AudioWorklet`
([`pcm-capture-worklet.js`](src/features/interview/pcm-capture-worklet.js)),
because every `MediaRecorder` output is a *container* and Gemini is handed these
bytes as raw samples. Two departures from the brief's reference snippet, both
deliberate:

1. **The resample carries its fractional cursor across render quanta.** The
   reference restarts at zero every 128 samples, which drops or repeats a
   fraction of a sample thirty times a second.
2. **The node runs into a zero-gain sink**, not nowhere. A graph is pulled from
   the destination; a node whose output goes nowhere may never have `process`
   called. Inaudible, and it cannot be optimised away.

The worklet is imported `?url&no-inline` — `?url` because the audio thread fetches
it by URL, `&no-inline` because Vite inlines assets under ~4 kB as `data:` URIs
and `addModule` rejects those. Without the second half the microphone works in
`vite dev` and fails in every deployment.

**Suppressed frames are sent as silence, never dropped.** The far end is a live
model with a continuous stream, and frames are its only proof the session is
alive. A client that stops sending for the twenty seconds Elena spends reading
five options is a client that has gone quiet, and the session gets restarted —
which the candidate experiences as Elena greeting them again.

**The microphone is gated, not muted, while she speaks** (`MicMode`). Muting
suppresses the echo *and* the interruption; streaming raw feeds her own voice back
to a VAD that then interrupts her mid-question, on any machine without headphones.
The gate keeps the difference: leaked echo is quiet, a person in the room is not.

## 12.4 Turn-taking is the frontend's, and that is the whole risk

The backend advances on `select` or `next` and **not on silence**. So
end-of-speech detection is ours, and an interview whose detector misfires is an
interview that stalls.

- Measured from the **microphone** (RMS per frame, ~30/s, refs only — state at
  that rate would re-render the room thirty times a second), not from captions.
  Captions are a transcription: a second late, and silent exactly when a pause
  happens.
- `ANSWER_SILENCE_MS` **2200**, inside the brief's 1.5–2.5 range. Asymmetric
  failure: advancing early costs marks on a question nobody can return to,
  advancing late costs a second of silence nobody minds.
- **Every question kind**, not just free text. A spoken "option B" is mapped by
  the backend when it receives `next`; the first version only advanced `text` and
  a spoken MCQ answer therefore never advanced at all.
- Gated on **`turn_complete`** (v2), with the older "she isn't audibly speaking"
  test as the fallback for a deployment that doesn't send it. This is what
  resolves the `next`-versus-follow-up race: a thin answer is a short one, so it
  is precisely when our clock would fire into her composing a follow-up.
- **Barge-in has two doors**: loud for ~100 ms, or ordinary speech sustained for
  ~500 ms (`BARGE_FRAMES` / `BARGE_SUSTAIN_FRAMES`). The second was added after
  the repetition loop in §12.6.
- `STUCK_MS` 15 s puts a gentle line on screen ("take your time… or press Done").
  Nothing advances on it. **Done** is visible on every question kind, because a
  detector this sort needs a manual path.

## 12.5 Captions arrive word by word

`{type:"caption"}` carries deltas — "Would", "you say", "that's", "Strongly" —
several a second. Both naive readings were tried in this session and both were
wrong in the visible way:

- **Frame per line** gave a column of one-word bubbles.
- **Join everything from one speaker** ran a greeting, a question, and a *re-ask
  of it* into one paragraph — which hid a broken session behind what read as one
  baffling repetition.

`addCaption` now closes a line on any of four things: the other speaker, a new
question, more than `CAPTION_JOIN_MS` (2 s) of nothing, or a finished sentence
plus `SENTENCE_GAP_MS` (0.7 s). It reads like the typed room's transcript, which
was the target. Every decision is made **outside** the state updater, off
`lastCaptionRef`: StrictMode runs updaters twice, and the version that flipped
`breakCaptionRef` from inside one lost its line break on the second run.

## 12.6 What the live runs found

Four symptoms, and each turned out to be a different thing. Worth keeping because
the diagnosis was not obvious from the screen in any of them.

| Symptom | What it was |
|---|---|
| "The old voice is playing" | `voice_mode` was false — nothing in the dashboard set it. §12.9 |
| Elena greeted the candidate **three times** in two minutes, re-asking each time | the backend restarting its session from question one. v2 fixed it: a new socket now resumes at the first unanswered question |
| The interview **submitted itself** three questions into thirty | ours. A `1000` close was taken as "finished". It now needs corroboration — `interview_complete`, or every answer recorded — and is otherwise a drop |
| Elena **re-asked until answered**, and only a raised voice broke it | half ours: her repeating kept the mic gated, so an ordinary answer was replaced with silence and she never heard it. Fixed by the sustained barge-in door. The other half is her prompt, and is **A3** in the backend request |

The one still open on their side: `error: voice_unavailable` four minutes into a
sitting, with **no `notice: reconnecting` first** — either their reconnect never
engaged or it failed silently (**A2**).

## 12.7 Elena in the recording

The recording is what `MediaRecorder` is given: camera and microphone. Elena is
neither, so a recruiter's playback of a voice interview was the answers and only
room echo where the questions were.

The fix is not the recipe in the brief. `MediaRecorder` ignores tracks added to
its stream after `start()`, and recording begins on the **camera screen**, minutes
before Elena exists. So `createAudioMixer` is created *inside*
[`use-recording.ts`](src/features/interview/use-recording.ts)`.start()` when
`mixAudio` is set: the recorder holds one track whose identity never changes and
whose *content* gains her voice later, through
`HostPlayer.recordingTrack` → `recording.addAudioTrack`. If the mixer can't be
built, the raw stream is recorded exactly as before — a recording without Elena
beats no recording.

## 12.8 Two bugs the handover found

Both were invisible until a real sitting fell back to typed mid-interview.

1. **The camera went black.** The rooms each render their own `CameraPane`, so a
   handover *replaces the `<video>` element* — and the page attached the stream in
   an effect keyed on `[media.stream, stage]`, neither of which changes at a
   handover. The pane now attaches it itself with a ref callback, which fires on
   the element rather than on a render. The recording was unaffected: it records
   the stream, not the element.
2. **The transcript emptied.** The two rooms keep transcripts in different places
   (socket captions vs page state), and the handover seeded only the current
   question — so someone mid-interview landed in a room claiming the interview had
   just started. The captions are carried over now.

Also from that path: a typed submit on a question voice already answered returns
**409 `already_answered`**, which surfaced as "that conflicts with something that
already exists" to a candidate who had just answered correctly out loud.
`isAlreadyAnswered` now moves past it silently.

## 12.9 Every interview is a voice interview

`voice_mode: true` is sent by [`createInterview`](src/services/hr/interviews.ts)
and by job create *and* update — **with no toggle anywhere**, by request. The
switch existed for about an hour and was removed: a per-candidate choice between
two kinds of interview is a decision nobody wanted to make and the one they would
forget into is the written one.

It stays a *request*: no voice host, no `AudioWorklet`, a blocked microphone — each
quietly gives the candidate the written interview, same questions, same scoring.
**Jobs created before this change carry `voice_mode: false`**; opening the job and
saving is enough to flip them, since the edit form always sends true.

`docker/nginx.conf.template` needed `voice` in the WebSocket location regex. It
was falling into the generic `/api/` block with a 300-second **idle** timeout,
which would cut Elena off mid-interview.

## 12.10 What earlier sections now get wrong

- **§7.1, §11.8** describe `use-voice-answers` as *the* voice control. It is now
  the **typed room's** host only — browser `speechSynthesis` plus the Web Speech
  recogniser — and is switched off entirely while `spoken` is true (`active:
  sitting && !spoken`). Two hosts reading every question over each other into one
  microphone is what that guard prevents.
- **§8.6's file list** for the candidate page is missing `use-voice-interview`,
  `voice-room`, `voice-audio`, `room-chrome` and `room-format`.
- **§9.2's recording description** is still accurate about the socket, but the
  recorder is no longer always given `media.stream` — see §12.7.

## 12.11 Open issues

1. **Nothing is committed.** Seven new files, eight edited, plus
   `BACKEND-REQUEST-voice.md`. §11.11's item 5 (the two deleted
   `BACKEND-REQUEST-*.md`) still stands underneath it.
2. **Three asks are open with the backend**, all in
   [`BACKEND-REQUEST-voice.md`](BACKEND-REQUEST-voice.md) under "Still open":
   **A2** the unexplained `voice_unavailable` with no reconnect, **A3** cap the
   re-asking, **B** what `turn_complete` means in time (their 800 ms VAD against
   our 2.2 s).
3. **Two frontend gaps, neither blocked on anyone.** There is **no way to answer
   without a voice** — no text input in the voice room, so a mute candidate or a
   dead microphone has only Done, which submits an empty answer; the handover
   machinery would make a "Type instead" button trivial. And there is **no level
   meter**, so a candidate has no feedback that they are being heard if captions
   don't arrive.
4. **The room is inherently audio.** Captions are rendered, but the accessibility
   story for a deaf candidate rests on them arriving.
5. **No tests.** `addCaption` and the turn-taking are pure decision code with zero
   coverage, and the repo has no frontend test setup at all.

## 12.12 Not verified — treat as unproven

- **Every audio number.** `MIC_SPEECH_LEVEL` 0.02, `MIC_BARGE_LEVEL` 0.05,
  `ANSWER_SILENCE_MS` 2200, both barge-in frame counts. Picked from typical RMS
  ranges, never measured in a real room. The two failure directions are both
  real: a noisy room never falls below the speech threshold (nothing advances), a
  quiet talker never crosses it (nothing counts as speech).
- **Barge-in end to end.** We stop the *sound*; whether the model stops
  generating is the backend's claim, which their own v2 notes say was validated in
  the output direction only.
- **The recording mix.** `{inputs: 2}` in the trace is the tell; nobody has played
  back a mixed recording.
- **Mobile and Safari.** Two `AudioContext`s, a worklet, a 24 kHz context, and
  iOS's habit of wanting a gesture per context. iOS is the likeliest place this
  simply doesn't start — and it would fall back to typed, silently.
- **`turn_complete` timing**, and therefore whether the follow-up race is
  actually closed.

## 12.13 Process notes

- **`npx tsc --noEmit` is a no-op in this repo.** The root `tsconfig.json` is
  solution-style (`references`, no `files`), so it type-checks nothing and exits
  0. Several rounds of "clean" meant nothing. Use **`npx tsc -b --force`**, which
  is what `npm run build` runs.
- **The React Compiler lint rules are on and strict.** Three separate errors were
  hit here: `set-state-in-effect` (setting state synchronously in an effect body),
  `immutability` / "accessed before it is declared" (a `useCallback` used above
  its declaration in the same component), and `preserve-manual-memoization`. All
  three wanted a real restructure, not a disable comment.
- **Anything in a socket effect's dependency list restarts the interview.** The
  worst near-miss of the session: `stuck` began as a dependency of the
  microphone-level callback, which is passed into that effect — so every long
  silence would have torn the socket down and had Elena greet the candidate again.
  Refs, not state, for anything that changes mid-sitting.
- **A large TypeScript file through a bash heredoc failed to parse** (unbalanced
  quote inside the content). Use the Write tool for new files; §11.12's warning
  about `perl -0pi` delimiters held too.
- **Prettier is not enforced in this repo** — 20 files fail `--check` on `main`.
  New files here are formatted; the tailwind class ordering in `voice-room.tsx` is
  deliberately left matching its sibling `interview-room.tsx` rather than
  prettier's, so the two rooms' identical markup stays identical.
- **`*/` inside a JSDoc comment closes it.** Writing `**/*.{ts,tsx}` in a comment
  in the worklet silently terminated the block.

## 12.14 Five frontend fixes, after the list was reviewed

Still session 7, still uncommitted. The voice feature was read back end to end
against §12 and five things were changed. **Three of them were defects found by
reading the code, not by running it** — worth saying, because §12.12's warning
that nothing here has met a live socket is still true, and these were reachable
without one.

`npx tsc -b --force`, `npx eslint src` and `npm run build` are clean with all
five in.

### 1. The first half-second of a barged-in answer was being sent as silence

The worst of the three, and invisible from the screen. The gate in
[`voice-audio.ts`](src/features/interview/voice-audio.ts) let a frame past only
at `MIC_BARGE_LEVEL` (0.06), while the *sustained* barge-in door in
[`use-voice-interview.ts`](src/features/interview/use-voice-interview.ts) needs
sixteen frames at merely `MIC_SPEECH_LEVEL` (0.02) — about 512 ms. So every one
of the frames that convinced the client someone was interrupting had already gone
up the socket as zeroes. A candidate answering at ordinary volume over Elena sent
her "…ption B", not "Option B", on a question that cannot be revisited.

Fixed with a bounded **pre-roll**: frames that are audible but under the barge
threshold are *held* (`PREROLL_FRAMES`, 24 ≈ 768 ms) instead of blanked, and
replayed in order the instant the gate opens. The buffer cannot in practice fill,
because the same quiet frame that resets the hook's sustain counter empties it.

This is the one exception to §12.3's "suppressed frames are sent as silence,
never dropped", and the trade is the right way round: the stall that rule exists
to prevent is the twenty seconds Elena spends reading five options, and every one
of *those* frames is below the speech threshold and still goes as silence exactly
as before. The hold is under a second and only ever happens while somebody is
audibly talking.

### 2. Muting Elena also deleted her from the recording

`createHostPlayer` hung the recording tap off the same gain `setMuted` writes to,
on the reasoning — stated in the comment — that the recording should be what
happened. That is the wrong frame. The recording is not evidence of what the
candidate heard; it is how a recruiter reviews the interview, and a muted stretch
came back as the candidate answering questions that are not on the tape, with
nothing to explain it. Precisely the half-a-conversation problem §12.7 exists to
solve, reintroduced one node downstream.

Now two gains: `bus` (everything she says, and where the tap hangs) feeding
`speakers` (what the candidate hears, and the only one `setMuted` touches).

### 3. `answer_recorded.transcript` was parsed and thrown away

`voice-socket.ts` has read it since it was written; the hook's `recorded` state
carried only `{index, choice, display}`. So on a **free-text** question — where
`choice` is null by design and `display` may be nothing — the readback that item 1
of the backend request was all about showed the candidate nothing at all.

`recorded` now carries `transcript`, and the room renders it as *Heard "…"*
under *Recorded*. On multiple choice the pair is the whole diagnosis; on free text
it is the only confirmation the words arrived.

Deliberately **not** offered with it: "tap the right option to correct that". A
`select` naming an already-recorded question comes back `notice: stale_frame` —
dropped, not applied — so the offer would be a button that does nothing. That is
item 8 of the backend request, and the room has a comment marking where the offer
goes if overwrite semantics ever land.

### 4. "Type instead" — the room now has a way to answer without a voice

§12.11's item 3, closed. It is one call into the handover that already existed:
`settle({kind: "typed", resumeAt, chosen: true})`, which lands the candidate in
the typed room at the question Elena was on with the captions carried over, the
same as a dropped socket does.

Two details that are not incidental:

- **It is confirmed, not immediate.** `spoken` only ever turns off (§12.1), so a
  misplaced tap costs someone the spoken interview for a sitting they cannot
  retake. The confirm replaces the control row rather than sitting beside it.
- **`VoiceHandover.typed` gained `chosen?: boolean`**, and the page words the
  notice from it. Telling somebody who just pressed "Type instead" that the
  spoken interview "couldn't continue" reads as though they broke it.

### 5. A microphone level meter

§12.11's item 3, second half. `MicLevel` in `voice-room.tsx` reads the hook's new
`levelRef` from an animation frame and writes the bars' opacity **directly** —
no state anywhere, because the level updates thirty times a second inside a live
interview. Attack fast, release slow, or it flickers on every syllable gap and
reads as a fault.

It is also the instrument for the mic test §12.14 asks for: full scale is twice
`MIC_BARGE_LEVEL`, so the first bar lights around the level an answer must clear
to register at all. **A meter that never gets past one bar in a working room is
`MIC_SPEECH_LEVEL` set too high for that room** — which is exactly the diagnosis
§12.12 says nobody has been able to make yet.

### What this changes about the sections above

- **§12.3** — "suppressed frames are sent as silence, never dropped" now has the
  one bounded exception in fix 1.
- **§12.7** — still right about the mixer and about `MediaRecorder` ignoring
  tracks added after `start()`. Its account of the player's graph is now one node
  out of date; see fix 2.
- **§12.11 item 3** — both gaps are closed. Items 1, 2, 4 and 5 stand.
- **§12.12** — `MIC_BARGE_LEVEL` is **0.06**, not the 0.05 written there. Every
  number in that list is still unmeasured, and fix 5 is the thing that will
  measure them.

### Still not done

Nothing in fixes 1–5 has met a live socket either. Fix 1 in particular is a
timing change to the audio path and its whole justification is a threshold
relationship — 0.02 against 0.06 — that has never been checked against a real
microphone. **The mic test is still the next useful thing, and it is now also the
test of these.**

---

## 12.15 The backend's v4 brief — what it changed here

**2026-08-27.** The backend answered everything outstanding in one consolidated
brief (v4): the nine v2 integration points, the A2/A3/B follow-ups, and the
five-point list from §12.14. Their side is built and green. Four things needed
changing here; the rest of the contract we already met.

`npx tsc -b --force`, `npx eslint .` and `npm run build` are clean.

### 1. `turn_complete` does not mean she has stopped talking

The single most important line in the brief, and it invalidated how §12.4 gated
the silence clock.

> `turn_complete` fires when Gemini finished **generating** the turn, i.e. the
> last audio byte has been relayed to you. Generation runs faster than real time,
> so it typically arrives while **seconds of Elena are still queued in your
> playback buffer** — it does NOT mean she has gone quiet in the room.

Our gate read: *if we have ever seen `turn_complete`, trust it and ignore whether
she is audibly speaking.* Which is exactly backwards — it let the answer clock
run while she was still talking out of the candidate's speakers.

The brief's rule is **all three**, and that is what the timer now requires:

1. the latest `turn_complete` has arrived;
2. our playback has drained (`hostSpeaking`), plus `HOST_TAIL_MS` for the room
   still ringing with it;
3. the microphone has been quiet for `ANSWER_SILENCE_MS`.

Condition 2 is now unconditional rather than the fallback for a deployment that
doesn't send `turn_complete`, so it still covers that case too. It can only ever
make advancing *later*, never earlier — affordable now that the server's 75 s
safety net sits underneath it.

**The numbers behind the follow-up race**, which we had never had before: a thin
answer goes candidate stops → **800 ms** server VAD → Gemini composes → first
follow-up audio **300 ms – 2 s** later. So her follow-up lands 1.1–2.8 s after
they stop, against our 2.2 s clock — about **1.4 s of slack**, which the backend
calls "usually safe, not guaranteed". `ANSWER_SILENCE_MS` is **left at 2200** and
its comment now carries these numbers: the brief assigns the final tuning to the
joint mic test, against their `VOICE_VAD_SILENCE_MS`, and moving it from a desk
would be guessing with better-looking numbers.

### 2. `notice: reconnect_exhausted`

New code, added to `VOICE_NOTICE` and handled. It changes nothing about what
happens next — `error: voice_unavailable` and close `4503` follow and do the work
— but its **absence** is what made §12.6's four-minute failure undiagnosable, so
it is traced.

Their diagnosis of that failure, for the record: the Gemini reconnect budget was
**cumulative across the whole interview** and had been spent by earlier drop
cycles whose notices were minutes back in the trace, so the final drop gave up
without trying. Budget is now per-incident with five retries, giving up
announces itself, and every drop is logged. **A2 is closed** — with the honest
note that the log for that specific session never existed.

### 3. The job edit form was silently flipping old jobs to voice

§12.9 said "opening the job and saving is enough to flip them, since the edit
form always sends true", and described that as the migration path. The platform
owner decided the opposite on 2026-08-27: **no backfill, jobs created before
voice stay typed**, voice is opted into on new jobs at creation.

That turns the edit form's behaviour into a silent modality change as a side
effect of editing a job title — nobody looks for it and nobody would connect it
to the edit afterwards. `voiceMode` is **no longer sent from the edit form** at
all, so a save leaves the mode alone. Create still sends `true`. Switching an
individual old job is still one `PATCH /api/hr/jobs/{id}` away, which is where a
decision like that belongs.

Also worth knowing, and unchanged by any of this: an interview **snapshots
`voice_mode` at creation**, so flipping a job only affects candidates scheduled
afterwards.

### 4. Overwrite semantics, confirmed final

Not a change — a confirmation that the call made in §12.14's fix 3 was right. A
recorded voice answer is **final**: a late `select`/`next` is dropped
(`stale_frame`), a typed submit on a voice-answered question is 409
`already_answered`. So the room correctly does **not** offer "tap the right
option to correct that", and the comment marking where that offer would go can
stay where it is indefinitely.

### What we already met

Every other point in the v4 contract was already implemented: the 16/24 kHz PCM
formats and the worklet (§12.3), `echoCancellation: true` on `getUserMedia`,
continuous streaming with the mic gate — **which the brief explicitly accepts and
tells us to keep**, since Gemini's VAD does no echo cancellation of its own —
flushing playback on `{type:"interrupted"}`, all eight close codes, both
reconnect paths, every `notice` and `error` code, `answer_recorded`'s four
fields, and the recording mix (§12.7, their §9, the one item assigned to us).

The brief's caveat on the gate — "barge-in and the start of a soft-spoken answer
only reach the server if the gate opens" — is precisely the defect §12.14's fix 1
found independently and closed with the pre-roll buffer.

### Still open, and it is the same thing it has been

**The joint mic test.** It now has a defined agenda from both sides: confirm
candidate→transcription end to end, tune their 800 ms `VOICE_VAD_SILENCE_MS`
against our 2.2 s window, validate barge-in and `interrupted` flushing with the
gate in place, confirm session resumption live by dropping the Gemini leg
mid-question (Elena should continue without re-greeting), and settle whether
75 s is the right safety net. Nothing in §12.14 or §12.15 has met a live socket.

---

## 12.16 The first live run — and the bug it found

**2026-08-27, `localhost:5173` against the deployed backend.** The first sitting
anyone has run against a live socket. It found one frontend bug, and it is the
worst one in this section: **a handover to the typed room was closing the
interview.**

### The `end` frame does not mean what the code thought it meant

The socket effect's cleanup sent `{type:"end"}` on every teardown, with the
comment *"tells the backend to close its Gemini session rather than leave it
running for a candidate who has gone."*

That is not what the frame is. The contract is one line and unambiguous:

> `{type:"end"}` — candidate ends early

The backend **finalises and scores the whole interview** on it, exactly as it
does for a vanished tab. And the commonest teardown by far is not a candidate
leaving — it is a **handover to the typed room**. So:

1. the voice host was lost (`error: voice_unavailable`);
2. we handed over to the typed room, correctly;
3. the teardown sent `end`, and the server finished and scored the sitting;
4. the candidate carried on typing into an interview that was already over;
5. half a minute later the heartbeat came back inactive and the room turned into
   **"This session was closed by the server. Contact the recruiter to reopen
   it."** — mid-answer.

Which is precisely what was on screen. It is race-dependent, and that is why it
did not show up every time: on the `voice_unavailable` path the server's `4503`
close is already in flight, so whether the frame goes out at all depends on
which arrives first. **`switchToTyped` had no such race** — the socket is healthy
when that button is pressed, so "Type instead" would have closed the interview
every single time.

`VOICE_END_FRAME` is now sent from **`end()` only**, which is the sitting
genuinely being closed. Closing the socket is all the Gemini session needs, and
per the brief a vanished tab is handled the same way. The constant carries the
warning now.

### What was NOT a frontend bug

The transcript showed the same question three times — and the instinct was that
the handover was seeding a duplicate. It wasn't. **`fullQuestionText` does not
render options**, and every repeated line carried "A: … E: …", so all three were
Elena's own captions. She really did ask it three times.

Worth keeping as a method note: the thing that made this decidable in seconds was
§12.5's line-breaking. The version that joined everything from one speaker would
have shown one baffling paragraph and the diagnosis would have gone the wrong
way — which is the exact failure §12.5 predicted.

The handover itself worked correctly, incidentally: the card was on question 2
while the last caption was question 1, i.e. it resumed at the first *unanswered*
question rather than re-asking the answered one.

### What is still the backend's, with fresh evidence

- **A3 — Elena re-asks, still.** Three asks inside about a minute (04:33, 04:34,
  04:34): the first with "Hello.", the next two without. v4 Part E §1 says the
  persona now asks once, nudges at most once, then waits.
- **A2 — `voice_unavailable`, and now *faster*.** The sitting died 1–2 minutes
  in, against four minutes in the run that prompted the original A2. v4 Part D
  claims a per-incident budget, five retries, and `notice: reconnect_exhausted`
  before giving up.

Both of those are v4 items marked shipped. **Either v4 is not deployed on the
instance this ran against, or neither fix holds** — and the trace tells them
apart in one line: if `voice_unavailable` arrives with **no `notice:
reconnecting` and no `notice: reconnect_exhausted`** before it, that is the v2
behaviour and the build is old. That question has to be settled before any more
frontend time goes into this.

### The fallback did its job

"After two questions it turned into the system voice" is the typed room taking
over — `use-voice-answers` and browser `speechSynthesis` — which is the golden
rule working, not a fault. The candidate kept their answers and kept going. What
was broken was only that, thanks to the `end` frame, the sitting they kept going
in had already been closed.

### Why the repeats had *no gap* — and the two fixes that came out of it

The re-asking was known (A3). What A3 does not explain is the **absence of any
pause to answer into**, and that turned out to be the more interesting half.

Her audio is generated far faster than it plays and queues here unbounded — the
scheduler has no ceiling on how far ahead of `currentTime` the cursor may run.
So there are two clocks: the server's, which starts when the last byte is
relayed, and the candidate's, which starts when they *hear* the end of the
question. The gap between them is the playback buffer, and on a five-option
Likert that is fifteen to twenty seconds.

The server therefore believes it has waited through a long silence while the
candidate is still on option C of the first ask; it re-asks; and the re-ask
queues **immediately behind** the first, because there was no gap on the wire.
The candidate gets a wall of the same question with nowhere to speak.

This also means **fixing A3 as written is not sufficient**: v4's "one gentle
nudge on a long pause" fires on the same clock, so the nudge will land inside the
question every time. That is now the lead item in
[`BACKEND-REQUEST-voice-live-run.md`](BACKEND-REQUEST-voice-live-run.md).

Two things changed here:

1. **`HostPlayer.queuedSeconds()`**, traced at `question` and `turn_complete`
   (`Ns of her still unheard here`). The drift was an inference; now it is a
   number in the console. It is the first thing to read on the next run.
2. **The mic gate turns itself off when there is no echo path.** The candidate in
   this run was wearing earphones — nothing was leaking back, so the gate was
   protecting against nothing while still standing between them and Elena, since
   their answer had to clear the barge-in doors first. `ECHO_PROBE_FRAMES`
   listens through five seconds of her speech and, if the microphone floor never
   rises above `ECHO_FLOOR`, drops the gate for the rest of the sitting.

   Only frames from before the candidate cuts in are counted, and a window whose
   peak is too high **starts again** rather than deciding "there is echo" for the
   whole interview — one cough should not settle it. The threshold is
   deliberately below `MIC_SPEECH_LEVEL` rather than equal to it: deciding
   "headphones" wrongly feeds her voice to a VAD that interrupts her with it,
   which is the failure the gate exists to prevent, so the evidence has to be
   clearly under the bar.

Both are unmeasured in the way everything else here is unmeasured. `ECHO_FLOOR`
in particular is derived from `MIC_SPEECH_LEVEL`, which is itself a guess — so if
the level meter says that number is wrong for a room, this moves with it.

---

## 12.17 The second live run — three bugs in what the candidate reads

**2026-08-27, rev 4 backend.** The first run the backend fixes were actually live
for. The voice half worked: one ask per question, answers recorded, spoken and
tapped answers both landing. What was wrong was **everything the candidate reads
about their own answer**, and all three were ours.

`npx tsc -b --force`, `npx eslint .` and `npm run build` are clean.

### 1. The previous answer stayed under the new question

`setRecorded` was called in exactly one place — the `answer_recorded` handler —
and **cleared in none**. The interface's own doc comment had said "cleared when
the next question arrives" since the day the field was added; nothing ever did
it.

So "RECORDED D. Agree" from question 16 sat under question 17, and 18, and every
question after. A candidate reading their screen sees the question they are being
asked with an answer already attached to it, which is the exact impression the
box exists to prevent.

Cleared on every `question` frame now, **and** the room guards its render on
`recorded.index === voice.index`. The belt-and-braces is deliberate: nothing
checked, which is why it survived this long.

### 2. A tapped answer was written to the transcript twice

`select` writes the line the moment the button is pressed — a tap makes no sound,
and without it the conversation shows Elena asking and nobody answering. Then
`answer_recorded` comes back carrying the same sentence in `display` and wrote it
again.

The comment in `answer_recorded` asserted this was safe because "`addCaption`
drops the repeat". **It doesn't.** `addCaption` only suppresses a repeat within
the *same turn* — same speaker, inside `CAPTION_JOIN_MS` (2 s). A server round
trip is routinely longer than that, so the two became separate lines, one under
the other, both stamped as the candidate.

`tapCaptionedRef` holds the question index a tap already captioned, and
`answer_recorded` skips its write for that index. Cleared in `resetTurn`, which
runs *after* the handler has read it — that ordering is what makes it work.

Matched on **index, not text**: our wording and the server's `display` agree
today, and a transcript that doubles the moment they stop agreeing is not a trade
worth making.

### 3. Captions came out stuttering — `"E: Strongly Agree Strongly Agree"`

`addCaption` handled two shapes of incoming delta and there are three. A fragment
wholly inside the line so far (drop it) and one that starts with the whole line
(it *is* the line, further along) were both covered. The third — **a fragment
whose first words are the line's last words**, because the transcriber revised
and resent its own tail — fell through to a plain append.

Over a question with five options read aloud, that produced a transcript of
stuttering nonsense that made a working interview look broken.

`joinOverlapping` finds the longest seam and splices there, longest overlap
first so a fragment that is *entirely* a repeat collapses to nothing added.
`CAPTION_OVERLAP_MIN` is 4 characters: below that it is coincidence — a line
ending in "e" meeting a fragment starting with "e" is two different words, and
splicing them would eat a letter of somebody's answer.

Checked against the real strings off the screen before shipping: the two observed
artifacts collapse, `"Would you say"` + `"that's"` and `"I like the"` +
`"there once"` correctly do **not** splice.

### Not ours — the transcription language

Question 7 of that run: the candidate spoke, and `answer_recorded.transcript`
came back as **Telugu**, from English speech. Elena then said "Please listen to
the question again", which was a reasonable response to what she had actually
received.

Worth noting the `HEARD` readback (§12.14 fix 3) did exactly its job here — it is
the only reason anyone knows the answer was recorded off unintelligible input
rather than off what was said. Backend item: what language is the STT configured
for, and can it be pinned.

### 4. Stale audio was blocking the candidate from answering at all

**The third run, and the worst symptom yet:** the card on **2/20** while Elena
read **question 1** for the third time, with taps and speech both going nowhere.

Nothing flushed the playback queue when a new `question` frame arrived. Her audio
generates far faster than it plays (§12.16), so a question asked three times over
sat here as a minute of queued sound — and the server moving on did not touch it.

The wasted time is the least of it. **A full queue holds `hostSpeaking` true**,
and that gates the microphone and keeps the answer clock shut. So the candidate
was locked out of the question actually in front of them by audio about a
question that was already answered — which is precisely "I select the option and
try to speak and it's not taking it".

Anything still queued when the next question is announced was generated for the
last one by definition. It is dropped now, above `STALE_AUDIO_S` (2.5 s) so a
short "Understood. Thank you." still survives the boundary. The trace says what
went: `dropping 47.2s of the last question still queued`.

### 5. `rev` is finally read

The backend added `"rev": 4` to `ready` on 2026-08-27, after two rounds of bug
reports turned out to have been filed against a stale deployment — the fixes
written, merged, and not running, with nothing on the wire to say so.

We were dropping it. `parseVoiceMessage` builds its result field by field and
silently ignores what it doesn't name, so `rev` never reached the trace and an
old backend was **indistinguishable** from a current one in our logs.

Read now, under both spellings, and logged on its own line at `ready`: the
version when present, and an unmissable warning naming the pre-rev-4 faults when
absent.

**Logged loudly and deliberately not fatal.** The backend's instruction is "if
rev is missing, stop and tell us", which is right for a test session and wrong as
shipped behaviour — a rollback would then take voice away from real candidates on
a build where it still works.

### Method note, again

All three of these were **claims in comments that had never been true**: "cleared
when the next question arrives", "`addCaption` drops the repeat". Both read as
settled fact and both described behaviour nothing implemented. §12.16's `end`
frame was the same shape of error — a comment asserting what a frame meant,
confidently, wrongly.

---

## 12.18 The v5 brief — the human layer

**2026-08-28.** The backend's v5 adds a self-introduction phase, a mid-answer
check-in, and a persona that never speaks on silence at all. Most of the contract
we already met. Four things needed changing, and one of them was silently
defeating a feature they had just shipped.

`npx tsc -b --force`, `npx eslint .` and `npm run build` are clean.

### 1. The answer clock was cutting off the check-in — and open answers with it

Rev 5 gives the server exactly **one** thing to say on silence: a candidate who
starts an open answer and trails off gets a single warm check-in after
`VOICE_CHECKIN_SECONDS` (10 s) — *"are you done, or would you like a moment?"*

`ANSWER_SILENCE_MS` was 2200 for **every** kind of question. `kindRef` existed
and the silence check never read it. So on a text question we advanced eight
seconds before she could ask, and the feature could not fire once.

The brief is explicit — the window on text must be longer than the check-in, or
open questions go manual. `ANSWER_SILENCE_TEXT_MS` is **12 s**, two clear of it,
and the introduction uses it too.

Nobody actually waits twelve seconds in silence: they trail off, she asks at ten,
and either they answer her — which restarts the clock properly — or they don't,
and the quiet after she finishes carries straight past twelve. They wait for
*her*, which is what a conversation feels like.

This partly reverses §12.4's "every question kind, not just free text". That
remains right about *whether* text advances; it was wrong about how long to wait.

**And it is gated, which was a second bug caught before it ran.** The long window
is long *because something else fills it*. Against a backend with no check-in —
rev 4, or a rev 5 with `VOICE_CHECKIN_SECONDS=0` — nothing does, and the
candidate finishes an answer and sits in twelve seconds of unexplained silence:
the "take your time" hint only appears for somebody who **never spoke at all**,
never for somebody who spoke and stopped. That is worse than the 2.2 s it
replaced, and it would have shipped as a regression introduced by a fix.

`checkinLive` decides, from two sources that fail in opposite directions. `rev`
is known from the first frame but only says the build *should* have a check-in.
Having actually **seen** one is proof, but arrives too late to help the first
open question. So: trust the version, and let observation confirm it. Without
either, the short window — what this app did for its whole life before rev 5 —
is the better of the two.

### 2. `{type:"intro"}` would have stranded the candidate

Unhandled — it fell to `default` and was ignored. `VOICE_INTRO_ENABLED` is off by
default so nothing was broken, but the moment it is switched on:

- no Introduction screen, and the card reads "Elena is about to begin";
- **`indexRef` stays null**, and `next` opens with `if (current === null) return`
  — so **Done does nothing** and there is no way to end the phase.

The index is the whole trap. It is `-1`, which is a *value*: `next` has to carry
it verbatim, and null is what "no question yet" means. Set explicitly on the
frame now.

The room says what the phase is and, above all, that **it is not scored** —
labelled *Introduction*, no counter (the arithmetic would read "0 / 20", which
reads as the interview having gone wrong before it began), no options. Somebody
who thinks they are being marked on "tell me about yourself" answers it quite
differently, and worse, than somebody who knows it is a warm-up.

`intro_complete` clears it a beat before question 0 arrives.

### 3. `notice: checkin`

Added, and it reopens the turn rather than waiting for her audio to do it. The
notice travels ahead of the sound and the gap is exactly long enough for our
clock to fire `next` into the question she is checking in about.

### 4. The capture context now asks for 16 kHz

**Possibly the most valuable line in the whole brief**, and it is a footnote in
their §3: create the capture `AudioContext` at 16 kHz and the browser resamples
the track on the way in, through a real anti-alias filter, leaving the worklet's
ratio at 1.

We were at 48 kHz and interpolating down in the worklet — decimation with no
low-pass in front of it. Everything above 8 kHz folds back into the band: not
silence, not noise, but plausible speech-shaped energy nobody said. A transcriber
handed that produces confident wrong words — and on 2026-08-27 it produced a
confident wrong **language**, English answered aloud and returned as Telugu, and
scored (§12.17).

That is a hypothesis, not a proven cause, and it is worth testing directly: the
trace already prints `captureRate`, so the next run says whether the browser
honoured it. Safe where it doesn't — the worklet reads the real rate off the
context at construction and resamples exactly as before.

### Also

`VOICE_MIN_REV` is 5. The `ready` check now distinguishes three states rather
than two: no `rev` at all (ancient), `rev` below 5 (protocol fine, but no intro
and no check-in will ever arrive however long you wait for them), and current.

### What v5 needed nothing for

`end` semantics (§12.16's fix, now confirmed in writing and code-verified on
their side), the three-condition silence gate, Done on every question, the mic
gate — which they again explicitly tell us to keep — the recording mix, all eight
close codes, both reconnect paths, and every frame and notice code from v4.

### Not done, and outside this app

The introduction transcript reaches the recruiter as a new additive
`introduction` field in results. **Nothing renders it**, so recruiters cannot see
it. Dashboard work, not interview-room work.

⚠️ **Closed in §12.22** — it renders now, in its own card at the top of the
report's Questions tab.

---

## 12.19 The v7.1 brief — rev 6, and the tool flow

**2026-09-07.** The backend's v7.1, which is the consolidated spec and says the
running protocol is **rev 6**. It also says "if you built against the v6 brief,
nothing you built needs rework" — **that does not apply here.** We built against
v5; there was never a v6 brief in this repo, so v6's changes are new to us too.

Six changes. `npx tsc -b --force`, `npx eslint .` and `npm run build` clean.

### 1. `VOICE_MIN_REV` 5 → 6, and it was failing in the dangerous direction

The check is `rev < VOICE_MIN_REV`, so a **rev 5 build passed it silently** and
logged "voice backend rev 5" as though all was well — while missing the entire
tool-driven flow. The one field that exists to stop us testing stale builds was
quietly endorsing one.

### 2. Our MCQ clock was racing the fix — 2200 ms → 6000 ms

**The most consequential change here, and it is not in their checklist.**

Since rev 6 there are two paths to resolving a spoken choice, and ours winning is
the bad outcome:

| Path | How "option B" is resolved |
|---|---|
| her `record_choice("B")` | the **model** maps their words to the letter — accent, phrasing, transcription quality all irrelevant |
| our `next` | the server falls back to resolving it **from the transcript** — the channel that wrote "option C" as "absentee" |

Her chain is ~1.5 s of server VAD plus up to ~2 s to decide and call: ~3.5 s. A
2.2-second window fired **into the middle of it**, and winning meant forcing the
unreliable path — actively racing the fix rev 6 exists to be. This is what the
brief means by "keep your detector conservative"; it does not spell out why.

Six seconds costs nothing in the normal case, which is the part worth
understanding: when she calls the tool at 3.5 s the interview moves at 3.5 s and
this timer never fires at all. It is only ever felt when she has already failed,
and the 75 s server net is the real backstop underneath.

### 3. The `HEARD` readback had become a false-alarm generator

§12.14's fix 3 surfaced `answer_recorded.transcript` so a mishearing was visible
in the moment. Rev 6 changed what is true underneath it. In the backend's own
words the channel "mislabels short utterances into random languages ('option C'
written as 'absentee') even though the MODEL understood perfectly", and captions
are now explicitly cosmetic.

So on a rating item the panel read:

```
RECORDED  C. Neutral      ← correct, from her structured tool call
HEARD     "absentee"      ← cosmetic garbage
```

A correct answer, with our UI insisting it was misheard — on a question the
candidate cannot go back and fix (`stale_frame`). Shown only when `choice` is
null now, where the words genuinely *are* the answer and this is the only
confirmation they arrived.

Worth keeping as a shape: a readback is only reassuring while the thing it reads
back is authoritative. When the backend demoted the transcript, the feature
inverted without a line of our code changing.

### 4. `notice: tool_advanced` / `tool_ignored`, and the `tool` field

Both were falling through to `default`. Not harmful — `question` and
`answer_recorded` release the controls anyway — but the `tool` field was not
parsed at all, so the trace could not say **which** tool fired. On a rev-6
sitting that is most of the log, and `record_choice` versus `skip_question` is
the difference between "she understood the answer" and "the candidate declined".
The tool is in the headline now, not buried in a collapsed payload.

`tool_ignored` is the presentation gate refusing a call on a question Elena had
not begun speaking. Informational, and it is the gate working rather than
failing.

### 5. Close code `4400`

Named. The *behaviour* was already right by accident: it is not in
`VOICE_TERMINAL_CLOSE_CODES`, so we retry, and a fresh socket sends `auth` first
— which is exactly the prescribed response. But there was no entry in
`VOICE_CLOSE_REASONS`, so the trace read "no reason given" in the one case where
the reason is the whole diagnosis.

### 6. `maxSeconds` is used rather than parsed and dropped

The intro cap (default 180 s) now sets the room's own line about scale. "Tell me
about yourself" is answered either in six words or for five minutes, and only one
of those is wanted — better to say so than to let somebody get cut off by a cap
they were never shown.

### What needed nothing

The presentation gate exempts `select`/`next`. The intro turn budget arrives as
`auto_advanced` with index `-1`, already handled. Their check-in now measures
quiet from the end of her audio in the room — our two-clock finding fixed on
their side — and our 12 s text window is still correctly above their 10 s. Server
VAD 1500 ms sits inside our range. The voice socket holding its own heartbeat is
belt-and-braces against the same class as §12.16's `end` bug.

### Their side, and one question worth an answer

`VOICE_INTRO_ENABLED` is **on** in their test env and they have verified a full
sitting end to end, so our intro UI is finally about to receive its first frame.

The open question: **is the `introduction` field in results built from the same
caption channel they have declared cosmetic?** If it is, recruiters will read
garbage in a report — and unlike a caption, that one is not cosmetic.

Also still unrendered anywhere: that `introduction` field. Dashboard work, and
nobody owns it.

⚠️ **Both closed in §12.22.** It renders, and the open question is answered —
the field *is* built from the cosmetic caption channel, evidenced by a live
payload reading `application.Yes.Don't`.

---

## 12.20 Four things the screenshots found

Not voice-protocol work — these came out of a recruiter and a candidate looking
at the screen, and three of the four were invisible to code review and obvious in
a screenshot. Worth recording as a group for that reason alone.

`npx tsc -b --force`, `npx eslint .` and `npm run build` clean throughout.

### 1. The transcript stopped following Elena mid-sentence

```js
}, [entries.length])
```

The auto-scroll fired on the entry **count**, which is only half of how that list
changes. Captions arrive several a second and `addCaption` *merges* them into the
bubble already on screen — so a bubble grows from one line to twelve without the
array ever getting longer. The scroll fired once when the bubble appeared and
never again, and the rest of her question wrote itself off the bottom of the
panel.

Reported exactly as "auto-scroll is working but some text is not visible", which
is a precise description of that bug and reads like a contradiction until you
know the cause.

Now keyed on the last entry's **text**, so every merged caption pulls the view
with it. Three smaller things changed alongside it:

- **`scrollTop`, not `scrollIntoView`.** The latter walks up the ancestor chain
  and will scroll the whole page to bring the panel into view — a real hazard
  here, since on small screens this sits inside another scroller.
- **No `behavior: "smooth"`.** At several captions a second each animation is
  interrupted by the next, so the view lags permanently behind the text it is
  meant to be showing.
- **It stops following if the reader scrolls up**, and resumes when they come
  back. The panel exists so somebody can re-read a question they half-heard;
  yanking them to the bottom on every caption makes that impossible.

That last one is decided from the reader's own scroll events, **not** measured
inside the effect — by then the DOM already holds the new text, so a bubble that
just grew 200px reads as "scrolled far from the bottom" and the panel would stop
following exactly when there is most to follow.

### 2. New interview opens with every round selected

The round chips started empty, which made the fullest interview the one a
recruiter had to opt into four times — and an empty row reads as "nothing here
yet" rather than "your company's defaults are in charge".

**The trade is real and is stated on the form.** Turning all four *off* is still
what selects the company defaults (the request omits `rounds` entirely and the
server resolves them); it is simply no longer where the form lands. A recruiter
who wants their configured rounds now has to clear the row to ask for them, and
a company whose defaults are deliberately narrower will find this widens every
interview created from this dialog.

`resume` and `jd` are the only rounds that *read* anything, and they are now on
by default for a recruiter who may paste neither. An amber line names whichever
of them has no source yet, live as you type or deselect. Deliberately **not**
auto-dropped on submit: silently removing a round somebody can plainly see
selected is the worse surprise of the two.

### 3. The last question said "Done →"

On question 30 of 30 the button promised a question 31, and the candidate found
out otherwise by landing on the finished screen. It now reads **"Finish
interview"** with a check mark.

Same action either way — `next` on the final index is what completes the sitting
— so only the wording and the icon change. Two other places on that card were
making the same promise and follow the same flag: the line under the question
("…asks the next question") and the long-silence hint, which was naming a button
that no longer exists.

The wording matches [`interview-room.tsx`](src/features/interview/interview-room.tsx),
which had `{last ? "Finish interview" : "Send answer"}` all along — the voice
room was the odd one out. That matters more than tidiness: a candidate can be
handed between the two rooms mid-interview and must not read the ending
described two different ways.

Guarded on `voice.index !== null` rather than the `position` fallback of 0 —
without it a one-question interview calls itself finished before its first
question has arrived.

### 4. Search by candidate name "didn't work" — and always had

Reported as "search works through role and email, I want candidate name too".
The accessor had included `candidateName` since it was written, and it verifiably
matched: `"chandu"` returns exactly one row, on the name alone.

The actual failure, on the real data:

```
"abhi"  ->  sathwik, abhi, chandu, abhi
```

Three of four rows are **other people**, because `peddinaabhinash999@gmail.com`
contains "abhi". Type a candidate's name, get a list led by somebody else, and
the reasonable conclusion is that the box is matching emails and ignoring names.

So the fix was not "add the name" — it was already there. `DataTable` gained an
optional **`searchPrimary`**: the field a reader most likely meant. With a query
active, rows matching in it sort first.

```
"abhi"  ->  abhi, abhi, sathwik, chandu
```

It **only reorders** — the same rows match, nothing is hidden, so searching an
email or a role still finds what it always found. A stable partition rather than
a sort, so the page's own order survives inside each group, and with no query or
no `searchPrimary` the order is untouched, which makes it inert for every other
table in the app. Wired into Results and Interviews, which had the identical
problem.

### The theme

Items 1, 3 and 4 were all reported as one thing and turned out to be another —
"auto-scroll is broken" was a dependency array, "name search is missing" was a
ranking problem, and the button was a promise nobody had noticed making. In each
case the code read as correct because it *was* correct about the thing it was
written for. A screenshot of somebody using it found all three in minutes.

That is the same lesson as §12.16 and §12.17, arriving from a different
direction.

---

## 12.21 The run that proved the client was overriding her — and the interview that would not close

**2026-09-07, and it is the most consequential finding of the whole voice
build.** The backend filed four issues off an ngrok sitting against a **current**
build — so for once not a stale-deployment report — and almost all of them came
down to one sentence:

> the client was advancing questions on its own end-of-speech detection instead
> of letting Elena's tools lead.

A screenshot from the same day then found a fifth, which nobody had filed and
which is the worst of the set: **the last question answered, and the sitting
would not close** — with the one button on screen disabled, and doing nothing
when it wasn't (item 7).

`npx tsc -b --force`, `npx eslint .` and `npm run build` clean. The answers to
their questions are written up in `BACKEND-REPLY-voice-2026-09-07.md`.

### 1. "Skip this question" was recorded as **C. Neutral**

The candidate said *"skip this question"* out loud on a rating item, and the
answer that came back was **Neutral** — a middle opinion recorded against
somebody who had declined, on a question they cannot go back and fix.

Since rev 6 a choice question can be resolved two ways, and they do not degrade
to the same thing:

| Path | "skip this question", spoken on a rating item |
|---|---|
| her `skip_question` | recorded as **declined**, no credit — what was asked for |
| our `next` | the server resolves the *spoken words* to a rating level, and those words are no level, so it **defaults to Neutral** |

Elena *saying* "sure, we can skip that" was just her talking. The thing that
actually recorded the answer was our `next` arriving first — so the fix was not
a longer window. §12.19 had already retreated from 2.2 s to 6 s for exactly this
reason, and the retreat has no natural stopping point short of not doing it:
**our `next` on a choice question is always resolved off the transcript, and the
transcript is the channel the backend itself calls cosmetic** — the one that
wrote "option C" as "absentee".

`clientMayAdvance(kind)` is the whole change: on `mcq` and `likert` this client
never ends a turn on its own detection. Three things still do, and between them
they cover everything the detector was covering — her tool call (the model maps
the words, so accent and transcription quality are irrelevant), a tap
(`{type:"select"}`, unambiguous by construction, which is why the options stay on
screen), and **Done** — a press, i.e. a person deciding, which is the one context
where the transcript path is the best answer available rather than a worse one
substituted for a good one.

Open questions keep the fallback. There is no option set to resolve against
there, so `next` and `answer_complete` record the same free text and racing
costs nothing.

### 2. The wait it buys, and why the room now talks through it

On a choice question where her tool never fires, the candidate waits for the
server's 75 s net instead of our 6 s timer. That is real, and a card that sits
there having apparently ignored a spoken answer is its own bug.

So `stuck` stopped being a boolean. It is `VoiceStuck` — `null | "quiet" |
"unrecorded"` — because the two situations look identical from the code and need
opposite things said to the person in the chair:

| Reason | What happened | What the room says |
|---|---|---|
| `"quiet"` | nothing said at all for 15 s | "Take your time… say 'I don't know', tap an option or press Done" |
| `"unrecorded"` | they answered, and it hasn't moved | "Heard you — Elena is recording that. If she doesn't move on in a moment, tap your answer above or press Done" |

`"unrecorded"` is deliberately **not** cleared by the microphone hearing speech,
which is where the old boolean would have gone wrong: it is *about* an answer
having been given, so speaking is not evidence against it, and clearing it on the
tail of the very answer that raised it would flicker it on and off through a
sentence. It goes when the question does, in `resetTurn`.

### 3. One automatic `next` per question

`hold()` lapses after `ANSWER_HOLD_MS` with no answer from the server, and the
clock — still looking at a finished answer on a question that has not moved —
would send another `next` at the same index. Which is the fallback path being
pressed *harder* in precisely the case where the evidence says nothing is acting
on it. `autoNextIndexRef` makes it once: one is a report, and the server's 75 s
advance is what actually recovers it.

### 4. `next N — candidate` versus `next N — clock`

The backend's console prints, per question, whether one of Elena's tools advanced
it or a client frame did. When it was a client frame the next question is whether
a *person* pressed something or our detector fired — the difference between a
candidate skipping and this client overriding her — and there is no field on the
wire for it. So `advance(source)` carries it into the trace with the question
kind: `next` is the candidate's own press, while the clock holds
`() => advance("clock")`.

Reading that difference off a screen recording is what made this run expensive.

### 5. The dev double-connect, which was only ever a fault in *their* log

`StrictMode` mounts every effect, tears it down and mounts it again, so the
socket effect really did construct **two** `WebSocket`s per sitting in dev. The
old continuation prompt said `connecting #N` starts at 2 in dev "and that is not
a fault", which was true from here — the first is closed while still
`CONNECTING`, so `onopen` never fires and it never sends `auth`.

It was a fault from **there**. Two connections arrive for one session, the newer
supersedes the older with `4409`, and the log for a clean dev sitting is
indistinguishable from a candidate opening a second tab. That is exactly the
ambiguity their double-greeting question could not be answered through, and
"it's harmless, ignore it" is not an answer anybody can act on.

Deferring the open by `CONNECT_SETTLE_MS` (100 ms) collapses the pair —
StrictMode's cleanup runs in the same task as its setup, so the first timer is
cleared before it fires and no socket is constructed. The effect body now lives
in a hoisted `connect()`, which is also why `sessionId` / `token` / `stream` are
captured as consts first: **TypeScript does not carry a parameter's narrowing
across a closure.**

`connecting #2` now means the same thing in dev as in production, and two new
lines make a double greeting attributable rather than arguable:

```
connecting #1 — the first socket of this sitting
ready on socket 1 of this sitting
```

Every `ready` is followed by a greeting, so the second line is the count of
greetings the candidate is owed. Two of them on socket 1 is the backend
rebuilding its own Gemini leg; two with `socket 2 of this sitting, reopened after
a close` is ours, and the close code above it says why.
`sittingConnectionsRef` exists rather than reusing `failuresRef` because progress
*resets* the failure budget — a reconnect after an answer would have reported
itself as a first attempt.

Confirmed to them, and true: `notice: reconnecting` / `reconnected` take no
socket action at all. We reopen only on a real close, with a retryable code,
inside a budget of three.

### 6. A record carrying only a `choice` rendered nothing

`answer_recorded` set the readback only when `display` or `transcript` was
present. A frame carrying a resolved `choice` and neither of those — plausibly
what a `skip_question` decline looks like — showed the candidate nothing, on the
one question class where the recorded answer is the thing most worth seeing.
Shown now, worded from `choice` where the server sent no `display`, because
"Recorded" with nothing after it is the one thing that box must never say.

`HEARD` still appears only when `choice` is null; §12.19's fix 3 stands.

### Issue 4, the end-of-interview stall — not closed

Theirs to diagnose from the server log, and we said so. What our trace
contributes to the repro: the last `next N — clock` / `— candidate` line names
the index it stopped at, `notice: auto_advanced` says whether their net fired,
and `interview_complete` is logged on its own line. Also worth their checking —
we do **not** treat a `1000` close as a finished interview without
`interview_complete` or every question confirmed recorded, so a sitting that
completed without that frame would land the candidate in the typed room and look
like a stall from the outside.

### 7. The last question answered, and the interview would not close

**Found in a screenshot from the same day, and it is worse than the four they
filed.** Question 22 of 22, `RECORDED have a skills like…`, "22 of 22 answers
recorded" — and the sitting just sat there. Bottom left: *"Taking your answer…"*.
Bottom right: **"Finish interview", greyed out.**

Three separate faults stacked into one dead screen, and each of them was
individually reasonable.

**The interview was over and nothing said so.** Finishing is a frame the server
sends — `interview_complete` — and it did not send one. Everything else in the
hook waits for it. The one place that had ever second-guessed it is the `1000`
close (§12.6), which completes on `interview_complete` **or** every question
confirmed recorded — and that second condition was sitting right there, true,
with the socket still open and nobody looking at it.

**The button was doing nothing, correctly.** "Finish interview" sends
`{type:"next"}`. A `next` naming a question the server has already recorded is a
**stale frame**: dropped, not applied (their §8, our `notice: stale_frame`
handler, which exists and does nothing but release the controls). So the only
control on screen was *correctly* ignoring every press, forever. This is the
worst kind of bug in this app's history — the candidate is doing the right thing
and the software is agreeing with itself.

**And it was disabled anyway.** `locked` includes `waiting`, and the last answer
of a sitting is *always* with the server at the moment the interview ends. So
that button spent the end of every spoken interview greyed out, and nobody
noticed because on every earlier question the frame that released it arrived a
second later.

The fix is `completeAllRecorded`, on the evidence the hook already accepts:

- `answer_recorded` arms `allRecordedAtRef` when `recorded.size >= of`;
- the ticking check finishes the sitting after `COMPLETE_GRACE_MS` (8 s) —
  waiting for her playback to drain so a closing line plays, capped at
  `COMPLETE_MAX_MS` (30 s) so a queue that will not drain cannot strand a
  finished interview;
- a press of the button runs the same sequence immediately rather than sending a
  `next` that is guaranteed to be dropped;
- `finishLocked` in the room lets it be pressed while that last answer is still
  with the server, and the status line reads *"That's everything — finishing your
  interview…"* rather than "Taking your answer…", which on a finished sitting
  reads as the thing having hung. For a while it had.

**It sends `{type:"end"}` on the way out, and that is deliberate.** The standing
rule (§12.16) is never on teardown and never before a fallback, because `end`
means "the candidate ends early" and *finalises and scores* — and it was closing
live sittings from a path that ran on every handover. Here there is no early to
end: every answer is in, and this is the frame that tells a backend which never
sent `interview_complete` to release the session rather than hold a Gemini leg
for somebody who has finished. It is the second of exactly two places that frame
belongs.

The one thing to be careful about was disarming. A `question` frame stands the
closing clock down — but **only when it names an index nothing has recorded**. A
re-read of a question already answered is what a reconnect or a repeat sends, and
letting that disarm a completion waiting on nothing else would put the interview
straight back to being unclosable.

Not proven against a live socket yet. What it is waiting to see is
`all 22 answers recorded — waiting 8s for interview_complete` followed by either
the frame or `every question is recorded (22/22) and no interview_complete came —
finishing`. **The second line is also a backend finding**: if it appears, their
`interview_complete` is not being sent on a sitting that completed normally.

### The method note

The bug was not in a line of code. Every piece of the end-of-speech detector was
correct about the thing it was written for, and §12.19 had already spotted the
race and *tuned* it — 2200 ms to 6000 ms, with a table explaining why ours
winning was the bad outcome. What it did not do was draw the conclusion that a
path which is always wrong should not be taken at all.

Tuning a race you have correctly described as unwinnable is the shape of error
worth remembering out of this one.

---

## 12.22 The introduction reaches the recruiter

**Dashboard work, and the one item §12.18, §12.19 and §12.20 all logged as
"nobody owns it".** The backend has been returning an `introduction` field on
`get-results` since rev 5. Nothing read it — it was not in `RawResults`, not in
`InterviewResults`, and not on the page — so the candidate's spoken
self-introduction was being recorded, transcribed, stored and thrown away at the
last step.

`npx tsc -b --force`, `npx eslint .` and `npm run build` clean.

### Its own card, above the questions and not among them

Three lines of service plumbing (`raw.introduction?.trim() || null`, so an empty
string cannot render a labelled blank card) and a card at the top of the
**Questions** tab: *"Tell me about yourself"* as the prompt, the transcript as
the answer, and where every other card carries a score badge, this one carries
**"Introduction · not scored"**.

That placement is the whole design decision, and it is not tidiness. The voice
room tells the candidate in as many words that the introduction does not count —
because somebody who thinks they are being marked on "tell me about yourself"
answers it quite differently, and worse, than somebody who knows it is a warm-up
(§12.18·2). Dropping it into `questionDetails` would break the promise at the
only point that matters: a recruiter would read a warm-up as a question that
scored nothing out of one, and mark the candidate down for taking the app at its
word.

Its own card rather than a row inside theirs, so the boundary is visible at a
glance rather than inferred from an absent badge. No empty state — a report
without an introduction is not missing anything, and every typed sitting is one.

The tab's counter still reads `Questions (22)`, because 22 is how many questions
there were.

### And the answer to §12.19's open question is yes

The first real payload settles it. From a live report:

```
"introduction": "…I have working with recruiter a based application.Yes.Don't
have any interest on that. application but I have to do that."
```

`application.Yes.Don't` — **the field is built from the caption channel the
backend has declared cosmetic**, and it arrives with the fragment separators
missing, exactly as §12.17's stuttering captions did. §12.19 asked whether this
would happen and noted that unlike a caption, this one is not cosmetic. It is
the candidate's own voice describing themselves, in a report a hiring decision
is made from, and welded sentences read as somebody who cannot write.

`readableTranscript` puts the spaces back, and it is **whitespace only and
deliberately timid**: a space after `.`/`?`/`!` only where a lowercase word of at
least two letters runs straight into a capitalised one. That is the one pattern
that cannot be anything but a lost sentence break. Initialisms are left alone
(`U.S.A.Later` stays wrong rather than becoming `U. S. A.`), decimals are left
alone (`1.5`), and **no word is altered**. Checked against the real string above.

A missed repair is the right failure here. A report is not the place to improve
somebody's answer for them, and the moment this starts rewriting words it stops
being a transcript.

**Still a backend item**, and now an evidenced one rather than a question: the
separators should not be lost on their side, and this only makes the symptom
readable.

---

## 12.23 What a candidate's screen recording found, and a deploy check

**2026-09-08.** All of these came from watching somebody sit the interview,
which is the third time in this file that has found more than code review did.

`npx tsc -b --force`, `npx eslint .` and `npm run build` clean.

### 1. Elena kept asking questions the camera couldn't see anybody to answer

**The worst of the four, and only half of it is ours to fix.**

The sitting is proctored: when the camera stops seeing a face, the microphone is
muted. That is not negotiable — this socket is live, everything she hears is
transcribed and scored, and an answer spoken off camera must not become a
recorded answer.

But Elena carried on. She finished the question, heard silence (we send silence
frames, never dropped — §12.3), the check-in fired, and the 75 s net advanced.
The screenshot is the whole bug in one frame: *"We can't see you — nothing you
say now is recorded"* on the left, and on the right the transcript filling up
with questions going by. Every one of them recorded as an answer never given, on
a question never heard.

`HostPlayer.setHeld` suspends the playback `AudioContext` for the duration. Her
audio keeps its place — `currentTime` freezes, everything scheduled stays
scheduled, frames arriving during the hold queue behind the cursor — and plays
from where it stopped once the candidate is back in frame. She asks the question
**once**, to somebody who can answer it.

Three details that were nearly wrong:

- **A hold is not a mute**, and the existing `setMuted` was the wrong tool.
  Muting turns the speakers down while the schedule runs underneath, so unmuting
  lands the candidate wherever she has got to by then, with the sentences in
  between simply gone.
- **`play()` auto-resumes a suspended context** — that line exists because a
  backgrounded tab gets suspended out from under us, and without it Elena goes
  silent for good. It would have undone the hold on her very next frame, which
  is continuously. Hence a `held` flag rather than reading `context.state`: a
  suspended context has two causes and they need opposite handling.
- **Deliberately not `setSpeaking(false)` on hold.** She has unheard audio and is
  mid-turn; saying otherwise opens the microphone gate and starts the answer
  clock on a question nobody has heard.

A reconnect builds a fresh player, so the hold is re-applied from the ref at
construction alongside the mute — otherwise a socket returning while the
candidate is still out of frame greets and re-asks into the same empty room.

**What this does not do is stop the server advancing, and nothing here can.**
The protocol gives the client four frames — `auth`, `select`, `next`, `end` —
and none of them means "wait". The check-in and the 75 s net are timers measured
from the end of her audio. So a face lost for a few seconds is now covered
completely, and a face lost for more than ~75 s is not covered at all.

`BACKEND-REQUEST-voice-camera-hold.md` asks for `{type:"pause"}` /
`{type:"resume"}`, with the **cap on their side** — a pause a client can hold
indefinitely is a proctoring hole, and the sitting's overall deadline must keep
running through it or covering the camera buys free time.

Not sending `next` to paper over this was a deliberate call: it would record a
wrong answer on purpose, which is §12.21·1 again from the other direction.

### 2. "Finish interview" read as disabled — because it looked it

Reported as "that finish interview is not enabled". It was enabled. It was an
`outline` button, which at the end of an interview, beside a question just
answered, reads as greyed out — and `disabled:opacity-60` on the same variant
means the enabled and disabled states are genuinely hard to tell apart.

Solid (`default`) on the last question now. On every other question it stays
`outline`, because there it is the safety net beside Mute and must not compete
with answering out loud; at the end there is nothing else to do.

### 3. The tick mark came off, and it is the same bug as §12.20·3

A check mark on a control **that has not been pressed yet** reads as *already
done*. §12.20·3 removed an arrow from question 30 of 30 for promising a question
31; this is the same false statement from the other direction, and it went in
during the same session that fixed the first one.

### 4. "Submit interview", in both rooms

Renamed from "Finish interview" on the candidate's ask. Changed in
`interview-room.tsx` as well as `voice-room.tsx` — §12.20·3 is explicit that a
candidate can be handed between the two mid-sitting and the ending must not be
described two different ways. Four occurrences in the voice room (the button,
and the two "press **Done**" hints, and the tooltip) and one in the typed room.

### 5. The recording played back at full card width

A webcam recording is one face. Stretched across a wide screen it filled a
1600px card with a head, upscaled well past what a laptop camera produces.
Capped at `max-w-160` (640px) and centred, still `w-full` underneath so it
shrinks properly on a narrow screen.

### 6. "Not scored" came off the candidate's introduction card

Two places said it — a chip where the question counter goes, and "**none of this
is scored**" in the body copy. Both gone by request.

§12.18·2 argued for them, and the argument was not wrong: somebody who thinks
they are being marked on "tell me about yourself" answers it differently, and
worse, than somebody who knows it is a warm-up. What it missed is *when* the
sentence is read. It is the opening seconds of the sitting, and it put the word
"scored" in front of a candidate before they had said anything — which sets
exactly the tone the warm-up exists to avoid.

The phase still reads as a warm-up without it: the label says **Introduction**,
there is no counter (nothing in its place now, rather than a chip), there are no
options, and "the questions come after" carries the same fact without naming the
scoring.

**The recruiter's report keeps its badge** (§12.22). Different reader, different
risk: there the danger is somebody marking a warm-up down as a question that
scored nothing, and the badge is the only thing standing between them and that.

### 7. The controls moved around by themselves between questions

Reported as *"why are those buttons displayed differently in each question"*,
with two screenshots — Mute and Done on the right in one, and dropped onto their
own row underneath in the other.

Nothing was conditional. The row was `flex-wrap` and the status sentence is a
different length on every kind of turn: *"Listening — just answer out loud."*
fits beside the buttons, *"Elena is asking — you can answer over her if you're
ready."* does not, so the whole button group wrapped. Two other sentences —
"Taking your answer…" and the finishing line — sit either side of that boundary
too, which is why it looked arbitrary.

The row no longer wraps. The sentence takes what is left (`min-w-0 flex-1`) and
runs onto a second line **inside its own column**, and everything with a fixed
size is `shrink-0`: both icons, the button group, and the meter — which is the
one that would actually have broken, because a flex item shrinks below its own
width without it and five fixed-width bars squashed to nothing is worse than a
wrapped line.

### 8. The Dockerfile's timeout rationale had gone stale

Not a fault, and worth recording because of what it would have cost. The
`--timeout=3600` note justified itself entirely on recruiter live viewing —
written before the voice interview existed. Anyone reading it to decide whether
they could drop the flag would have concluded it costs them an optional feature.

**It costs the candidate their interview.** Cloud Run counts a WebSocket as one
request and cuts it at the timeout, so at the 300 s default a thirty-minute
spoken sitting loses the voice host four times over — each drop a reconnect, a
re-greeting, and eventually the typed fallback. All three long-lived sockets are
named now, that one first.

Checked at the same time, and all correct as they stood: `Permissions-Policy`
names `camera` and `microphone` explicitly (omitting a feature *denies* it),
`/api/voice/` is inside the socket location's regex with 3600 s timeouts and
`proxy_buffering off`, `apiSocketUrl` derives `wss:` from the page protocol, the
capture worklet ships as a real file in `/assets/` rather than a `data:` URI
(`&no-inline` earning its keep — it is 5.0 kB against Vite's ~4 kB inline
threshold, and `addModule` rejects a data URI), the `.mjs` MIME fix still has its
`grep` guard, and `.env` is both gitignored and dockerignored. The voice work
introduced no new environment variable.

**Not verified by building the image** — the Docker daemon was not running. This
is a read of the config plus a clean `npm run build`, not a proven image.

### The theme, again

Items 2, 3, 5, 6 and 7 are all *"the code was correct and the screen was wrong"* —
and 6 is narrower than that: the code and the screen were both right, and the
sentence was simply being read at the wrong moment. Item 1 is a rule (mute off
camera) and a flow (she keeps asking) each behaving exactly as designed and
combining into something neither of them intended.

None of items 1–7 is visible in a diff. Item 8 is the opposite case and worth
keeping beside them: a comment that was true when written, describing a system
that had since grown a third socket, quietly giving the wrong operational
advice. Nothing tests a comment.

---

## 12.24 Continuation prompt

> The voice interview (Gemini Live) is **committed** as of session 8 — 7 new
> source files and 19 edited, pushed to `origin/main` and to
> `company/superadmin-admin-hr`, which sat at the same commit before it. See §12
> of `SESSION-HANDOVER.md`; `npx tsc -b --force`, `npx eslint .` and
> `npm run build` are clean.
>
> ⚠️ **Every `BACKEND-REQUEST-*.md` in this repo was deleted before that commit**
> — the three older tracked ones (`time-up`, `live-progress`, `tab-close`) and
> the two voice ones written in session 7. The tracked three are recoverable from
> history at `32ea410`; `BACKEND-REQUEST-voice.md` and
> `BACKEND-REQUEST-voice-live-run.md` **never were committed and are gone.**
> Sections §12.11–§12.17 cite them freely and those citations now lead nowhere;
> what survives of that correspondence is quoted inside this file, and
> `BACKEND-REPLY-voice-2026-09-07.md` is the current open thread with the
> backend.
>
> **Read §12.21 and §12.19 first.** §12.19 is the contract as it stands — the
> backend's **v7.1 brief, protocol `rev: 6`** — and it supersedes every earlier
> brief this file cites. §12.21 is what a live rev-6 sitting then did to it: the
> client was **overriding Elena's tool calls with its own end-of-speech
> detection**, and a spoken "skip this question" was being recorded as *Neutral*.
> §12.11 and §12.12 are the oldest sections and the most wrong; §12.14 through
> §12.21 correct them piece by piece.
>
> **Check the rev before anything else.** The first trace line of a sitting says
> `voice backend rev 6`, or warns that the build is older. Three rounds of bug
> reports on both sides were filed against stale deployments before that field
> existed. **Findings from a build that is not rev 6 are not worth filing.**
>
> ### What has actually run
>
> Four live sittings, which found five real bugs — all fixed, none of them
> visible to code review: an `end` frame on teardown that was **closing live
> interviews** (§12.16), a stale answer readback, a doubled transcript line,
> stuttering captions (§12.17), a full playback queue locking the microphone so
> neither speech nor taps could land (§12.16), and **this client's `next`
> beating her `skip_question` and recording a declined rating question as
> Neutral** (§12.21).
>
> The rev-6 tool flow itself has now had one sitting: `tool_advanced` arrived,
> and so did the transcript-resolution path it exists to replace.
>
> ### What has never run
>
> Treat all of this as unproven, because it is:
>
> - **The whole self-introduction phase.** The UI handles `intro` /
>   `intro_complete` and has never received either frame. Their flag is on in the
>   test env now, so the next run is its first. The part to distrust is **Done**
>   — ending the phase depends on `next` carrying index `-1`.
> - `notice: checkin`, `tool_advanced`, `tool_ignored`, the stale-audio flush,
>   the echo probe, the pre-roll, and the 16 kHz capture context.
> - The introduction card in the report (§12.22) — the field itself is proven,
>   the card has not been looked at by a recruiter yet.
> - **The camera hold** (§12.23·1). `setHeld` suspends the playback context so
>   Elena waits instead of asking a question the muted candidate cannot answer.
>   Untested against a live socket, and it only covers a face lost for less than
>   the server's 75 s net — the rest needs `{type:"pause"}` from the backend
>   (`BACKEND-REQUEST-voice-camera-hold.md`).
> - **The client's own completion** (§12.21·7). Watch for
>   `all 22 answers recorded — waiting 8s for interview_complete`, then either
>   the frame or `…no interview_complete came — finishing`. **The second line is
>   a backend finding as well as ours** — it means they are not sending
>   `interview_complete` on a sitting that completed normally.
> - **Every audio constant.** `MIC_SPEECH_LEVEL`, `MIC_BARGE_LEVEL`,
>   `ECHO_FLOOR`, both barge frame counts. The 16 kHz change also lowers RMS
>   readings, so they are now guesses calibrated against a different signal than
>   the one they will see.
> - Playing back a mixed recording. Mobile and Safari — the likeliest place this
>   simply never starts, and it falls back to typed *silently*.
>
> ### Reading a run
>
> Tracing is on in dev; elsewhere `localStorage.setItem("ra:trace","1")`. Each
> line names a different fault by its absence:
>
> | Line | What it proves |
> |---|---|
> | `voice backend rev 6` | you are testing the right build (start here) |
> | `captureRate: 16000` | the browser honoured the anti-aliased resample |
> | `Ns of her still unheard here` | the playout gap — large means she is running ahead of the room |
> | `no echo path — peak 0.0xxx` | the gate turned itself off; absent means it never did |
> | `notice: checkin` | the 12 s open-question window has something filling it |
> | `notice: tool_advanced (record_choice)` | she recorded the answer herself — the rev-6 path working |
> | `recording both voices {inputs: 2}` | Elena is in the recording |
> | `next 7 — clock` | **this client ended the turn, not her.** Never legitimate on `mcq`/`likert` now; on those the source is always `candidate` |
> | `all N answers recorded — waiting 8s…` | the sitting is over; the next line says who closed it |
> | `ready on socket 1 of this sitting` | one greeting owed. A second greeting with this line unchanged is the backend restarting its own Gemini leg, not us |
> | `connecting #N — …` | says *why* it opened: first socket, or reopened after a close. **No longer starts at 2 in dev** (§12.21·5) |
>
> ### Standing don'ts, each learned the hard way
>
> Do not add a Next button (§12.4). **Do not send `{type:"next"}` to finish an
> interview whose every question is recorded** — it names a question the server
> has already answered, comes back as `stale_frame`, and is dropped; that is a
> button doing nothing on every press, forever (§12.21·7). Do not mute the microphone while Elena speaks
> — gate it (§12.3). Do not treat a `1000` close as a finished interview
> (§12.6). **Do not send `{type:"end"}` on teardown or before a fallback** — it
> finalises and scores the interview, and it was closing live sittings (§12.16).
> **Do not gate the answer clock on `turn_complete` alone** — it fires at
> generation end, seconds before her audio has played out of the buffer; it takes
> all three conditions (§12.15). Do not shorten the 12 s window on open
> questions — the server's check-in has to be able to happen inside it (§12.19).
>
> And the one this session added, which is the same lesson one step further:
> **do not let this client advance a question that has options.** Its `next` is
> resolved off the transcript the backend calls cosmetic, so "skip this question"
> becomes *Neutral* — a wrong answer recorded against a candidate, not a slow
> one. Her `record_choice` / `skip_question`, a tap, or a press of Done. There is
> no window short enough to make that path good (§12.21·1); tuning it from 2.2 s
> to 6 s was §12.19 correctly describing a race and then trying to win it.
>
> ### Open with the backend
>
> `BACKEND-REPLY-voice-2026-09-07.md` answers their three questions from the
> 2026-09-07 run and asks four back, none blocking:
>
> 1. **what `skip_question` puts on the wire** — a decline carrying no `display`
>    and no `choice` is the one record still invisible to the candidate;
> 2. `references/voice-test.html`, still unanswered — a known-good rev-6 client
>    is the fastest way to settle "is it us or you";
> 3. ~~is the `introduction` field built from the caption channel they call
>    cosmetic~~ — **answered: yes.** A live payload came back with
>    `application.Yes.Don't`, fragment separators missing. It renders in the
>    report now (§12.22) and `readableTranscript` puts the spaces back, but the
>    separators should not be lost on their side;
> 4. what language the STT is pinned to (§12.17's Telugu transcript of English
>    speech).
>
> Their Issue 4 — the interview stalling at the end of that run — is **not
> closed**, and needs their server log rather than anything from here (§12.21).

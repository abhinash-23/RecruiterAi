# Backend request — a closed tab shouldn't destroy the interview

**From:** frontend · **Date:** 2026-08-13
**Summary:** when a candidate closes the tab mid-sitting, two things are lost that
the server already has. Neither needs new data — only a decision about what to do
with it.

---

## 1. What happens today

The candidate's page fires a beacon on `pagehide`:

```
navigator.sendBeacon("/api/interview-closed", {session_id, interview_id, reason})
```

Per §8.5 and §11 of `API-DOCUMENTATION 2.md`, that **marks the interview
abandoned**. Two consequences follow, and both are worse than they need to be.

### 1a. The recruiter gets nothing, although every answer was scored

`GET /api/get-results/{id}` returns `results: null` until an interview is
*finished*. An abandoned one is never finished, so the report has no
`overall_score`, no `round_breakdown`, no `question_details`, no `vitals_report`.

But every answer the candidate did give was already submitted **and scored** by
`POST /api/submit-answer`, which returns a score and feedback per answer. So a
candidate who answered 22 of 30 questions and then closed the tab leaves the
recruiter a red *Abandoned* badge and a blank report — while the 22 scores sit in
the database.

This is the same failure we fixed once before on our side: the *End interview*
button used to call `interview-closed`, and the recruiter saw "Abandoned" with no
report despite every answer being scored (§3 of `SESSION-HANDOVER.md`). We changed
that button to call `finish-interview` instead. A closed tab has no such option —
nothing runs after the tab is gone.

### 1b. The candidate is locked out and cannot come back

`POST /api/verify-otp` answers **409 — "already started in another tab (one
sitting per link, enforced atomically)"**. So a candidate whose laptop slept, whose
browser crashed, or who closed the wrong tab reopens their link and is refused. The
sitting is unrecoverable for them and for the recruiter. In practice this is a
support ticket and a re-invitation every time.

---

## 2. What we're asking for, in priority order

### A. Score what was answered, instead of discarding it

When an interview ends without `finish-interview` — the beacon, or the
`sweep-abandoned` cron — and `answered > 0`, run the **same finalisation** and
populate `results`.

Keep the status honest and distinct: `abandoned` (or a new `incomplete`) with
`results` present, so a recruiter can tell "left after 22 of 30, scored on those
22" from "never started". Please include `answered` and `total_questions` in the
report as you already do, and leave unanswered questions out of
`question_details[]` rather than sending them with a zero — a `0` reads on our
screen as an answer that was marked wrong.

**Frontend cost: none.** The report page already renders `results` whenever it is
non-null. It would simply start showing them, and we'd add a "partial" label.

### B. Let a candidate resume within a grace window

Relax the one-sitting-per-link lock: if the same `interview_id` + email re-verifies
**while the sitting is unfinished and its link has not expired**, return the
existing session instead of 409 — with enough to resume:

```jsonc
{ "resumed": true,
  "session_id": "…",            // the same session, not a new one
  "answered": 22,               // so we open at question 23
  "next_index": 22,
  "seconds_left": 412,          // the server's clock, not ours
  "questions": [ … ] }          // the same set, in the same order
```

`seconds_left` matters: our countdown lives in the tab and dies with it, so on
resume the clock has to come from you or a candidate gets a fresh 30 minutes by
reloading. You already compute this for the live `progress` frames.

A window of 10–15 minutes would cover a crash or a sleeping laptop without turning
into "come back tomorrow". Anything longer probably wants the recruiter's consent.

**Frontend cost: small.** We seed the question position from `next_index` and the
clock from `seconds_left`, and show "Welcome back — carrying on from question 23".

### C. `pagehide` is not "closed" — let the heartbeat decide

This one is a correctness issue regardless of A and B. **`pagehide` fires when a
tab is backgrounded on mobile Safari, when a phone locks its screen, and when a
page enters the back/forward cache** — all cases where the candidate returns
seconds later. Treating the first beacon as abandonment is too eager, and it is
almost certainly firing on candidates who never left.

Please treat the beacon as *"the client went quiet at T"* and let the existing
`sweep-abandoned` job make the call: mark it abandoned only if **no heartbeat has
arrived for N minutes**. We already send `POST /api/heartbeat` every 30 seconds
while the sitting is active, so a tab that comes back announces itself within half
a minute.

The beacon also carries a `reason` we set (`"pagehide"`). Please use it —
a pagehide is not the same event as consent refused or an explicit end.

### D. Security: `interview-closed` is unauthenticated

The doc notes no auth header is needed "because beacons can't set one". True for
*headers* — but a beacon can carry a **body**, and we already hold the candidate
token. As it stands, anyone who learns a `session_id` can end someone else's
interview with one unauthenticated POST.

Please accept `candidate_token` in the body and reject the call without it. **We
will send it as soon as you accept it** — it is a two-line change on our side, and
we'd rather not leave that endpoint open.

---

## 3. Also worth confirming

- **The partial recording.** Your recording guide says a stream with no `stop`
  frame is sealed automatically within ~10 minutes. Please confirm that recording
  is still linked to the interview when the interview is marked abandoned —
  playback is keyed on the interview id, so a sealed-but-unlinked video would be
  invisible to the recruiter.
- **`tab_switch_count`.** We send it on every vitals frame and again on
  `finish-interview`. On a closed tab, only the last frame's value survives. If you
  want the final number, we can add it to the beacon body — say so and we will.

---

## 4. Why this matters more than it looks

A closed tab is not an edge case. It is a laptop sleeping, a phone call arriving, a
browser crashing, a candidate misclicking — on a 30-minute assessment taken once,
by someone who is nervous. Every one of those currently costs the full sitting, and
the recruiter cannot tell that candidate apart from one who never showed up.

Item **A** alone turns most of those from a lost interview into a partial one.
Item **B** turns them into no loss at all.

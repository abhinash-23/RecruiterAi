# Backend request — the time limit should be enforced by the server

**From:** frontend · **Date:** 2026-08-25
**Summary:** the sitting's clock is currently counted down in the candidate's
browser and enforced nowhere else. The frontend now submits the interview when it
reaches zero, but that is a courtesy, not a limit: close the tab, background it,
or open devtools and the limit stops existing. The server already knows the
duration — this asks it to hold the deadline.

---

## 1. What happens today

`verify-otp` returns `time_minutes`. The candidate's page turns that into
`secondsLeft = time_minutes * 60` and counts down with a one-second interval in
JavaScript. As of frontend commit `22d1d9e` reaching zero calls
`POST /api/finish-interview`, so a candidate sitting at their desk with the tab
open is submitted on time.

Nothing else stops them. Specifically:

| Situation | What the server does today |
|---|---|
| Tab backgrounded | browsers throttle timers in hidden tabs, so the candidate's clock runs **slow** and they get extra real time |
| Tab closed at 00:01 remaining | no submit is sent; the sitting stays open and unscored until someone notices |
| Machine sleeps mid-sitting | the clock resumes where it stopped — the limit becomes "n minutes of being awake" |
| `submit-answer` called an hour after the limit | **accepted** |
| The countdown edited in devtools, or the finish request blocked | no effect on what the server accepts |

The last two are the ones that matter for scoring integrity: a timed technical
round is only timed if the server says so.

---

## 2. What we're asking for

### 2.1 Stamp a deadline when the sitting starts, and store it

At the point the sitting begins — `verify-otp`, or wherever `started_at` is
already recorded — compute and persist an absolute deadline:

```
deadline = started_at + time_minutes
```

Absolute, not remaining: a stored duration has to be re-derived on every read
and drifts differently in each place that does it.

### 2.2 Refuse answers past it

`POST /api/submit-answer` and `POST /api/submit-answer-voice` should reject a
submission after the deadline rather than scoring it. A distinct, recognisable
response so the frontend can say the right thing:

```jsonc
// 409 (or 403 — any status we can tell apart from a validation error)
{ "detail": "The time limit for this interview has passed.",
  "code": "time_up" }
```

Please **don't** answer this with a plain `400` — it would be indistinguishable
from a malformed answer, and the candidate would be told to fix something they
cannot fix.

### 2.3 Finish the sitting server-side when the deadline passes

The important half. Whatever the candidate's browser is doing, the sitting
should end and be scored on what was answered — the same path
`finish-interview` takes, not the abandonment path. Either on a timer, or
lazily the next time anything touches the session (an answer, a heartbeat, a
recruiter reading `get-results`) — lazily is fine and is probably less work.

This is what makes a closed tab produce a report instead of a sitting stuck at
`in_progress` forever.

### 2.4 Tell the heartbeat about it

`POST /api/heartbeat` already answers `{ "active": boolean }`, and the frontend
already ends the sitting when `active` turns false. If the deadline has passed,
please return `active: false` — and, if it's cheap, say why:

```jsonc
{ "status": "ok", "active": false, "reason": "time_up" }
```

With a `reason` the candidate gets *"Your time ran out — your answers were
submitted"*. Without one they get the generic *"This session was closed by the
server"*, which reads like a fault. Either is workable; the reason is nicer.

### 2.5 Send the deadline to the client — the one change we'd ask for first

Add the deadline to the `verify-otp` response:

```jsonc
{ "…": "…",
  "time_minutes": 30,
  "expires_at": 1787654321 }   // epoch seconds, absolute
```

This is the smallest change with the biggest effect on the *visible* problem.
Given an absolute deadline, the on-screen clock becomes
`expires_at - now` rather than a local counter — so it cannot drift, cannot be
slowed by a background tab, and survives a reload showing the right number. We
will switch to it as soon as it exists; until then the displayed clock and the
server's idea of the time remaining can disagree, and the server's is the one
that counts.

`seconds_left` on the live-relay `progress` frames is already the server's
clock, so the value clearly exists — this is asking for it on the candidate's
own read too.

---

## 3. What we are *not* asking for

- No change to `time_minutes`, or to where the duration is configured.
- No change to `finish-interview`'s request or response.
- Nothing about the invitation link's own expiry (`link_expiry_hours`), which is
  a separate window and already enforced.
- No pausing. The frontend holds its own clock while the candidate is off camera;
  if the server's deadline should pause too, that is a product decision we should
  make together rather than something to infer from this document.

---

## 4. Test checklist

1. Start a sitting with `time_minutes: 1`. Wait 90 seconds with the tab **closed**.
   Then read `get-results` → the interview is finished and scored on what was
   answered, not stuck `in_progress`.
2. Same sitting, then `POST /api/submit-answer` → refused with the `time_up`
   code, and the answer is not scored.
3. `POST /api/heartbeat` after the deadline → `active: false`.
4. Start a sitting, background the tab for the whole duration, come back →
   the server still considers it over.
5. A sitting well inside its limit → all of the above behave exactly as they do
   today. No existing verdict or in-flight sitting changes.

---

## 5. Frontend work this unblocks

- The clock switches to `expires_at`, so what the candidate sees is what the
  server will enforce.
- `submit-answer` handling the `time_up` code shows "your time ran out" instead
  of a generic failure.
- The heartbeat's `reason` picks the right closing screen.

None of it is blocking: the current client-side submit stays in place and keeps
working for the ordinary case.

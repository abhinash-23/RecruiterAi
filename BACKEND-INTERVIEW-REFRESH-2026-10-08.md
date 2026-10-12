# Saving an interview when the candidate refreshes

**Date:** 2026-10-08
**From:** frontend
**Scope:** `interview-closed`, `verify-otp`, `resend-otp`, `get-results`, `GET /api/interviews`.
**Summary:** a candidate who refreshes or closes the tab mid-interview loses the
whole interview: it is marked `abandoned`, nothing is scored, and the link can
never be used again. We need the backend to **score what was answered** when a
sitting is left, and ideally to **let the candidate come back** after an
accidental refresh. The frontend cannot fix this on its own.

---

## 1. What happens today

1. Any refresh, tab close or navigation fires `pagehide`. The browser does not
   say which of the three it was.
2. On `pagehide` the frontend sends `POST /api/interview-closed` with
   `sendBeacon`:

   ```json
   { "session_id": "…", "interview_id": "…", "reason": "pagehide" }
   ```

   No auth header — a beacon cannot carry one.
3. The server marks the interview `abandoned`. Answers already submitted are
   never scored, so the recruiter sees **Abandoned** and no report.
4. The reloaded page has no session (it was kept in memory only), so it shows
   the code screen.
5. `verify-otp` and `resend-otp` both refuse with:

   > This interview was previously closed before completion and is no longer available. Please contact your recruiter to request a new link.

**Also seen in testing:** a reload **after** `verify-otp` but **before** the
interview starts (consent or camera step) cannot get a new code either. The
frontend sends no `interview-closed` at that point, so this refusal comes from
the server itself — most likely the code is one-shot once verified. Please
confirm.

## 2. What we need, in one table

| # | Change | Priority | Fixes |
| --- | --- | --- | --- |
| 1 | Score the answered questions on `interview-closed` | **Required** | Answers lost on refresh / tab close |
| 2 | Grace period before finalising | Recommended | An accidental refresh ends the interview |
| 3 | Resume after a reload | Recommended | Candidate cannot continue |
| 4 | New code before the interview starts | Recommended | A reload on consent / camera is fatal |
| 5 | Machine-readable refusal codes | Needed for 3 and 4 | Frontend has to match error text |
| 6 | Record why the interview ended | Nice to have | Recruiter can't tell a refresh from a finish |

Change 1 alone stops answers being lost. Changes 2 + 3 together let the
candidate survive an accidental refresh, which is the better outcome.

## 3. Change 1 — score on `interview-closed`

- Do what `finish-interview` does: score every answered question, leave the
  rest blank, produce the report.
- Seal and link the recording from whatever chunks arrived.
- **Idempotent.** The frontend's own refresh dialog calls `finish-interview`
  first, and the tab may still send `interview-closed` after it. The second
  call must be a no-op — no error, no status change.
- Final status: `completed` with a reason (change 6), or `abandoned` *with* a
  report. Your call — tell us which.

## 4. Change 2 — grace period

- Treat `interview-closed` with `reason: "pagehide"` as **disconnected**, not
  final.
- Finalise (change 1) only if no heartbeat, answer or reconnect arrives within
  a window. We suggest **60 seconds** (heartbeats are every 30).
- The sitting clock keeps running during the window; the deadline does not
  move.

## 5. Change 3 — resume after a reload

- Inside the grace window, `verify-otp` on an in-progress interview returns the
  **same** session instead of refusing: same `session_id`, questions,
  `expires_at`, `voice_mode`.
- Add the questions already answered, so the typed room continues at the first
  unanswered one:

  ```json
  { "...": "...", "answered_indices": [0, 1, 2] }
  ```

  The voice socket already resumes at the first unanswered question by itself.
- `resend-otp` must work for an in-progress interview inside the window, since
  the first code is spent.
- Consent is not asked again on resume.

## 6. Change 4 — new code before the interview starts

While the status is `created` or `consent_given` (verified, nothing answered),
allow `resend-otp` and `verify-otp` again. Today a reload on the consent or
camera step is as final as one mid-interview, with nothing to lose.

## 7. Change 5 — refusal codes

Refusals from `verify-otp` and `resend-otp` should carry a `code` beside the
message, so we can pick the right screen without matching words:

| `code` | Meaning |
| --- | --- |
| `interview_closed` | Left or abandoned; can't be reopened |
| `interview_completed` | Already submitted |
| `interview_expired` | Link window has passed |
| `not_invited` | Still a draft |

## 8. Change 6 — why it ended

Add `ended_reason` to `get-results` and to each `GET /api/interviews` row:

| `ended_reason` | Meaning |
| --- | --- |
| `completed` | Answered every question |
| `candidate_ended` | Pressed End interview |
| `time_up` | The clock ran out |
| `page_left` | Refreshed or closed the tab and didn't come back |

A recruiter reading a half-empty report then knows the candidate left.

## 9. Security — needed before change 1

Once `interview-closed` can submit a sitting, it must check the caller like
`finish-interview` does.

- **Today it is unauthenticated** — the `session_id` is the only credential.
  That was acceptable while it only marked a sitting abandoned; a call that
  submits someone's interview needs more.
- **Option A:** accept the candidate token in the beacon body
  (`{session_id, interview_id, reason, token}`) and check it belongs to that
  session.
- **Option B:** accept `Authorization: Bearer <candidate token>`; the frontend
  would send it with `fetch(…, { keepalive: true })` instead of a beacon.
- Either works for us — tell us which.
- Resume (change 3) must still require a valid code; never hand a session out
  on the interview id and email alone.
- Rate-limit `interview-closed` and the resume path per interview, like
  `resend-otp`.

The frontend keeps **no token** in browser storage — after a reload it knows
only the interview id and how far that tab got.

## 10. What the frontend already does

Built on our side, not yet released:

| Situation | Frontend now | After your changes |
| --- | --- | --- |
| F5 / Ctrl+R during the interview | Own dialog; **Submit and end** calls `finish-interview` and waits | Unchanged |
| Toolbar refresh button / closing the tab | Browser's own "Reload site?" prompt, then the `interview-closed` beacon | Beacon carries the token; answers scored (change 1) |
| Reload in the same tab, mid-interview | "Your interview was closed" screen instead of the code screen | Code screen again, resuming at the next question (change 3) |
| Reload on the consent / camera step | "Your interview was closed" screen | Code screen with a working Resend (change 4) |
| `verify-otp` / `resend-otp` refused | Server's message on the code screen | Screen chosen by `code` (change 5) |

The browser's prompt on the toolbar button cannot show custom text in any
modern browser, and the page gets no chance to submit after it is confirmed —
so change 1 is the only way that path saves anything.

## 11. Open questions

- [ ] Is the code one-shot once verified?
- [ ] After change 1: `completed` with a reason, or `abandoned` with a report?
- [ ] Is 60 seconds the right grace window?
- [ ] Token in the beacon body, or `Authorization` on a keepalive fetch?
- [ ] On resume, does the recording continue or start a second one linked to
      the same interview?

## 12. Test checklist

- [ ] Answer 3 of 20, close the tab, wait out the window: report exists with 3
      scored, 17 blank.
- [ ] `finish-interview` then `interview-closed`: one report, no error, status
      unchanged by the second call.
- [ ] `interview-closed` without a valid token is refused and changes nothing.
- [ ] Refresh mid-interview, reopen inside the window, enter a fresh code: same
      session, continues at question 4, clock not reset.
- [ ] Same in a spoken interview: the voice socket resumes at the first
      unanswered question.
- [ ] Refresh on the consent step: Resend sends a code and Verify works.
- [ ] A finished interview refuses `verify-otp` with `code: interview_completed`.
- [ ] The interview list and report show `ended_reason: page_left` for a left
      sitting.

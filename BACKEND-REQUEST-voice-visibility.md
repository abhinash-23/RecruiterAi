# `voice_mode` — fixed on the schedule path, and one ask left

**Date:** 2026-09-09
**Status:** the main issue is **closed**. This is the leftover.

---

## Closed — thank you

`POST /api/hr/jobs/{job_id}/schedule` now accepts an optional `voice_mode`
override, symmetric with create-interview. That was the fix, and it is the one
we asked for.

Our client sends `voice_mode: true` on that call and on every other creation
path, hardcoded in the service layer rather than passed by callers — because a
caller that _can_ omit it is exactly how the two paths drifted apart in the first
place. We also removed the `PATCH`-the-job-first workaround we had built while
the override didn't exist; it cost an extra request and an Activity Logs entry on
every schedule, and the override makes it pointless.

We have **not** built the recommended toggles, and that is a deliberate product
call rather than an oversight: every interview here is spoken. There is no switch
on the job form and none in the schedule dialog. The fallback to the typed room
is automatic and per candidate — no audio APIs, a blocked microphone, a dropped
socket — so a recruiter never needs to choose, and a choice they _can_ get wrong
is a candidate sitting the wrong interview. If that changes, both endpoints
already support it and the toggles are a small addition.

The snapshot rule is surfaced in two places now: on the job's shortlist page
("applies to interviews scheduled from now on — anyone already scheduled keeps
the interview they were sent") and in the schedule dialog itself.

## Still open: put `voice_mode` where staff can read it

**The cheapest ask in the original request, and the reason this survived months
of daily use.** `voice_mode` appears in exactly one response on the whole API:

| Response                       | Carries `voice_mode`?                                          |
| ------------------------------ | -------------------------------------------------------------- |
| `POST /hr/interviews`          | no                                                             |
| `POST /hr/jobs/{id}/schedule`  | no                                                             |
| `GET /hr/interviews` (the row) | no                                                             |
| `get-results`                  | no                                                             |
| `verify-otp`                   | **yes** — the candidate's own call, with the candidate's token |

So no screen we render can show which interview a given candidate will sit. A
recruiter could not see that two of their own buttons produced different
interviews; it was reported by a candidate, not by the console. And it is still
true for every interview created before today — we cannot tell a recruiter which
of their existing invitations are spoken and which are typed.

**Please add `voice_mode` to `InterviewRow`** (and, if it is cheap, to the
`get-results` payload). We will render it per interview in the Interviews table
and on the report immediately. It costs you a field and it turns this class of
bug from "found in production by a candidate" into "visible in a table".

## Also answered, and both changed code — thank you

**`skip_question`.** `notice: tool_advanced (tool=skip_question)` →
`answer_recorded` with `choice: null`, scored 0, counting in the denominator.

The consequential half is `choice: null`, because that is also what every
free-text answer looks like — so the record cannot be told apart from an ordinary
one, and a decline was landing in the branch that renders nothing at all. We now
carry the `tool` value across from the notice to the record, and the room shows
**Declined** plus the part nobody would guess: _"Skipped questions score zero and
still count towards your total."_ Nowhere else in the product told the candidate
that.

If `answer_recorded` for a decline ever starts carrying a `display` ("Skipped",
say), we will prefer it over our own wording — no change needed either side.

**`interview_complete` timing.** Understood, and it matches what we want.

We are **keeping** our 8-second client-side completion net, and want to be
transparent about why rather than have you find it in a log: a real sitting
reached 22 of 22 recorded and never closed, which under your contract should not
have been possible. Either it is fixed or it is an edge case nobody has
characterised. The net now traces itself as a **deviation from your stated
contract** rather than as a missing frame, so if it ever fires we will file it
with the run rather than absorb it silently.

## Related, still open

- `BACKEND-REQUEST-voice-camera-hold.md` — `pause` / `resume` while the camera
  can't see the candidate. Still the one thing we cannot work around: a face lost
  for longer than the 75 s net still burns a question.
- `references/voice-test.html` — a known-good rev-6 client, still the fastest way
  to settle "is it us or you".
- Whether the `introduction` field in results is built from the caption channel
  you have declared cosmetic. If it is, recruiters read garbage in a report —
  and unlike a caption, that one is not cosmetic.

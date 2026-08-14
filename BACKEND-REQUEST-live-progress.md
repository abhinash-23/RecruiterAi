# Backend request — let the recruiter see questions and answers during a sitting

**From:** frontend · **Date:** 2026-08-12
**Size:** one JSON frame on a socket you already have open. No new endpoint, no new auth.

---

## 1. What we lost, and why it isn't a frontend problem

The live interview page shows a recruiter three things: video, vitals, and the
candidate's **questions and answers as they happen**.

That third one used to be published by the *candidate's own browser* over the
WebRTC data channel, beside the video — because no server read exposes it while
an interview is running. Live view v2 replaced WebRTC with the relay (correctly:
the peer connection never formed on corporate networks), and the data channel
went with it. Video and vitals are fine. Q&A is now a single number: `answered`.

We checked every endpoint on the deployed API. For an interview **in progress**, a
staff token can read exactly two things:

| Read | What it gives mid-sitting |
|---|---|
| `GET /api/interviews` | an `answered` **count** — no question text, no total |
| `GET /api/get-results/{id}` | `results: null` until the candidate finishes |

There is no single-interview detail route, and staff cannot see the question list
mid-sitting either — questions only reach the *candidate*, through `verify-otp`
with their own token. So we can't even render "question 7 of 30", because we have
no way to learn the 30.

**The data is already yours.** Every answer arrives at `POST /api/submit-answer`
as the candidate gives it — that is how `answered` increments during the sitting
and how everything is scored at `finish-interview`. Nothing new needs capturing.
This is a **read that doesn't exist**, not data that isn't there.

---

## 2. What to build — option A (our preference)

`WSS /api/live-relay/{interview_id}` is already open for the whole sitting,
already authorised to exactly the right people (the HR who created the interview
and that company's admin), and already pushes JSON status frames
(`stream-live`, `stream-offline`, …). Add one more frame type on it:

```jsonc
{
  "type": "progress",

  "answered": 7,               // int  — answers submitted so far
  "total_questions": 30,       // int  — the whole question set
  "current_index": 7,          // int  — 0-based index of the question on screen
  "current_round": "Psychometrics",   // string|null
  "current_question": "I continue until everything is perfect.",  // string|null
  "scenario": null,            // string|null — the situational text, see §4
  "seconds_left": 1284,        // int|null — server-side clock, optional

  "exchanges": [               // every answer so far, oldest first
    {
      "index": 0,              // int  — the question's own index
      "round": "Resume",       // string|null
      "question": "Tell me about a system you designed…",
      "scenario": null,        // string|null
      "answer": "At my previous role I led the migration of…",
      "at": 1754912345000      // epoch ms, optional
    }
  ]
}
```

**When to send it:**

1. **On connect**, right after `auth-ok` — so a recruiter opening the page at
   question 20 gets the whole backlog immediately. This is the same courtesy the
   relay already extends to video, where a late joiner receives the init segment
   plus the last few seconds.
2. **Again each time an answer lands** (i.e. after `submit-answer` /
   `submit-answer-voice` succeeds), and when the question advances.

**Send the full list every time — not a delta.** Thirty questions is a tiny
payload, and a full snapshot means neither side needs sequencing, replay, or
gap-detection logic. The same reasoning as `tab_switch_count` being cumulative.

### Safe to deploy in either order

Our client already ignores frame types it doesn't recognise (it logs them and
moves on), so **you can ship this before we ship support for it** — nothing
breaks either way. No change to auth, the viewer cap, or the binary stream.

---

## 3. Option B — a plain GET, if a socket frame is awkward

```
GET /api/interviews/{interview_id}/progress      (staff bearer token)
```

Same body as §2 minus the `type` field. Same ownership rule and the same
**404-means-either-"no such interview"-or-"not yours"** behaviour as
`/api/recordings/by-interview/{id}/playback-url`, so we can treat a 404 exactly
as we already do there.

We'd poll it every 5–10 seconds while the live page is open. It works, it's just
more requests and up to 10 seconds staler than option A.

---

## 4. Four rules that matter to what a recruiter sees

1. **No scores while the sitting is running.** They're assigned at
   `finish-interview`. A `score: 0` on an answer that simply hasn't been marked
   yet renders on our screen as *"the candidate got this wrong"* — so please omit
   the field entirely until it is real, rather than sending `0` or `null`.

2. **Include `scenario` next to `question`.** The psychometric and soft-skills
   rounds ask things like *"What do you do?"*, which means nothing without the
   situation it refers to. We display the two together.

   ⚠️ **The same gap exists on the finished report.**
   `get-results → question_details[].question` comes back without the scenario
   today, so a completed sitting shows *"What do you do?"* with no context. Worth
   fixing in the same pass — either store the scenario with the question, or
   return it as its own field.

3. **snake_case is fine** — our client reads either spelling. Just please be
   consistent with the rest of the API rather than mixing styles in one payload.

4. **`null` is not `0`.** If `total_questions` isn't known for an interview, send
   `null`; we render "unknown" rather than implying a zero-question sitting.

---

## 5. How to check it works

With an interview mid-sitting, connect to the relay as a viewer and confirm:

- a `progress` frame arrives immediately after `auth-ok`, already containing
  every answer given so far;
- a new one arrives within a second of the candidate submitting an answer;
- `current_question` matches what the candidate has on screen at that moment;
- for a situational question, `scenario` is populated and `current_question` is
  the short prompt;
- no `score` field appears anywhere until the interview finishes.

---

## 6. What we'll do with it

Restore the panel that existed until today: newest answer first, the current
question under the video, and a progress bar against `total_questions`. Roughly
an hour of frontend work — the UI is written, it just has nothing to read.

Until then the recruiter's live page shows the answer count and a note pointing
at the report, and we tell them to turn sound on: Elena reads every question
aloud and the candidate answers out loud, so the audio in the relayed stream
carries the whole interview even though the text doesn't.

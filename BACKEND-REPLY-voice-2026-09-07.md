# Voice interview — answers to the 2026-09-07 test-run findings

**To:** backend team
**Re:** your notes on the ngrok run (local backend on :8080, ~16:31)
**Pairs with:** `FRONTEND-VOICE-INTERVIEW.md` v7.1 / protocol `rev: 6`
**Status:** the client changes are done. `npx tsc -b --force`, `npx eslint .`
and `npm run build` are clean.

---

## The key question, answered

> Does your client send `{type:"next"}` automatically from its own
> speech-detection, or only when the user taps a visible "Done/Skip" button?

**It did, from its own speech detection, on every kind of question — including
rating and MCQ. Your diagnosis of Issue 1 is correct and that was the cause.**

It is no longer possible. As of this change:

| Question kind             | What can end the turn from the client                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `likert` (rating), `mcq`  | a tap → `{type:"select", index, choice}`, or a press of **Done** → `{type:"next"}`. **Our speech detection never sends anything.** |
| `text` (open)             | a press of Done, or our end-of-speech fallback after 12 s of quiet                                                                 |
| introduction (index `-1`) | a press of Done, or the same 12 s fallback                                                                                         |

So on a rating item nothing this client sends can reach the transcript-resolution
path unless a person pressed a button. `record_choice` and `skip_question` are
now the only automatic path, which is what you designed.

Two supporting changes went in with it:

- **One automatic `next` per question, ever.** Our answer-hold lapses after 8 s
  with no reply, and the clock used to fire a _second_ `next` at the same index —
  leaning harder on the fallback in exactly the case where the evidence says
  nothing is acting on it. Now the client reports once and the 75 s server
  advance is what recovers it.
- **The trace says who ended each turn.** Every `next` we send is logged as
  `next 7 — candidate` or `next 7 — clock`, with the question kind. Your console
  already says "tool or client"; ours now says "client, and which kind of
  client", so the two logs can be laid side by side without a screen recording.

### What this costs, so you know what to expect

On a rating question where Elena's tool call does not arrive, the candidate now
waits for your 75 s net instead of our 6 s timer. That is a real wait, so the
room stops sitting silent through it: once the answer sounds finished and the
question hasn't moved, the card says

> Heard you — Elena is recording that. If she doesn't move on in a moment, tap
> your answer above or press **Done**.

Both of those settle it instantly. We would rather a candidate waits three
seconds and reads that than has "skip this question" recorded as _Neutral_.

---

## Issue 1 — "Skip this question" recorded as C. Neutral

Ours, fixed as above. Nothing needed from you.

One note for your side, because it decides how visible the next one of these
would be: **we surface the record, and it is the only place a candidate can see
it.** `answer_recorded` now shows a `RECORDED` line whenever the frame carries
`display`, a `transcript`, or a `choice` — previously a frame with only a
`choice` and no `display` rendered nothing at all, which is plausibly the shape
a `skip_question` record takes. If `skip_question` produces a frame with neither
`display` nor `choice`, tell us what it _does_ carry and we will render that
instead; a decline the candidate cannot see recorded is the one case still
invisible.

`HEARD` remains shown only when `choice` is null, per v7.1 §3 — with the
transcript declared cosmetic, showing it next to a correct structured record
turned a reassurance into a false alarm ("RECORDED C. Neutral / HEARD
absentee").

---

## Issue 2 — Elena reading a question five behind

Largely the same root cause, and the same fix removes it: with our clock out of
the loop on choice questions, the index no longer jumps ahead of her audio on
the fast-skipped ones.

The three-condition gate you cite in §B·6 was already implemented and is
unchanged. For the record, all three, and the trace line for each:

1. `turn_complete` has arrived and nothing of hers has arrived since — her audio
   and her captions both reopen the turn, so the clock cannot run through the
   gap between two of her sentences;
2. **our playback buffer is drained**, plus a 500 ms tail for the room still
   ringing. `turn_complete` fires at generation end, so we log
   `her turn is complete — 12.4s of her still unheard here` — that number is the
   playout gap, and it is the one to read if this recurs;
3. the microphone has been quiet for the window (12 s open / 6 s choice — the
   latter now unreachable automatically).

We also flush the playback queue when a new `question` frame arrives and more
than 2.5 s of the previous turn is still queued (`dropping 47.2s of the last
question still queued`). That was a real bug from an earlier run: a full queue
holds our "host speaking" flag true, which gates the microphone, so the
candidate was locked out of the question in front of them by audio about one
already answered.

---

## Issue 3 — the double greeting

**Confirmed: one `WS /api/voice/{session_id}` per interview, and we do not
reconnect on `notice: reconnecting` / `reconnected`.** Those two notices only
put "Elena is reconnecting" on screen and reopen her turn; no socket action of
any kind is taken on them. Your Gemini-leg reconnects are yours and we leave
them alone.

We reconnect in exactly one circumstance: the socket actually closed, the code
is retryable, and we have budget left (3 attempts, backed off). `4409`,
`time_up` and the terminal codes never retry.

**But we found one thing on our side worth telling you about, and it is probably
what your log showed.** The app runs under React `StrictMode` in dev, which
mounts every effect, tears it down and mounts it again — so our socket effect
really did construct **two** WebSockets per sitting in a dev build. The first
was harmless _here_ (it is closed while still `CONNECTING`, so it never sent
`auth`), which is why we had it written down as a known non-fault. It was not
harmless _in your log_: two connections for one session, the newer superseding
the older, is indistinguishable from a candidate opening a second tab — which is
exactly the ambiguity this issue could not be answered through.

That is now collapsed: the open is deferred 100 ms, so StrictMode's pair becomes
one connection and the first socket is never constructed. `connecting #2` means
the same thing in dev as in production.

Two new trace lines make the remaining ambiguity decidable next run:

```
connecting #1 — the first socket of this sitting
ready on socket 1 of this sitting
```

Every `ready` is followed by a greeting, so that second line is the count of
greetings the candidate is owed. **Two greetings with `ready on socket 1` twice,
or with no second `connecting` line at all, is your Gemini leg restarting behind
a socket that never dropped — not us.** Two greetings with
`connecting #2 — socket 2 of this sitting, reopened after a close` is ours, and
the close code above it says why.

If the run you saw was against a dev build, the two-socket behaviour above is
the first thing to rule out, and it can't happen again either way.

---

## Issue 4 — the stall at the end

Nothing we can call from here either, and we agree it needs the server log. What
we can offer for the repro: if it was a **stall**, our trace will show
`notice: auto_advanced` firing or not firing, and the last `next N — clock` /
`next N — candidate` line names the index everything stopped at. If it was a
genuine completion, `interview_complete` is logged on its own line and the room
switches itself.

One thing to check on your side while you have the log open: we do **not** treat
a `1000` close as a finished interview unless `interview_complete` arrived or
every question is confirmed recorded. If the sitting really did complete but
`interview_complete` was never sent, the candidate lands in the typed room with
everything already scored — which would look like a stall from the outside.

---

## A fifth one, which nobody filed — the interview that would not close

Off a screenshot from the same day, and it may well be the same underlying thing
as your Issue 4. Question **22 of 22**, the answer recorded, the card reading
"22 of 22 answers recorded" — and the sitting would not end. No
`interview_complete` ever arrived.

**Three faults of ours stacked on top of that**, all now fixed:

1. **Nothing acted on "every question is recorded."** We waited for
   `interview_complete` and nothing else, even though this client already
   accepts "every index the server named, confirmed recorded" as sufficient on a
   `1000` close. It now finishes the sitting itself 8 s after the last
   `answer_recorded` if that frame hasn't come — waiting for Elena's playback to
   drain first so her closing line plays, capped at 30 s.
2. **"Finish interview" was sending `{type:"next"}`** — which names a question
   you have already recorded, so it comes back as `notice: stale_frame` and is
   dropped. Your behaviour is correct; ours was a button doing nothing on every
   press, forever. It now runs the closing sequence directly.
3. **And it was disabled.** Our controls are held while an answer is with the
   server, and the last answer of a sitting always is at the moment it ends — so
   that button spent the end of every spoken interview greyed out.

**We send `{type:"end"}` on that path**, and we want to flag it explicitly since
you have (rightly) seen us misuse that frame before. It goes _only_ when every
question you named is confirmed recorded — there is no "early" left to end — and
it is there to let you release the Gemini leg for a candidate who has finished.
If you would rather we never sent it and left the session to time out, say so and
we will drop it; nothing else about the completion depends on it.

**What we need from you:** the trace now prints
`all 22 answers recorded — waiting 8s for interview_complete` and then either
your frame or `every question is recorded (22/22) and no interview_complete came
— finishing`. **If that second line shows up on a normal sitting,
`interview_complete` is not being sent when the last answer is recorded** — and
that is very likely your Issue 4 seen from this end, since a candidate on the
final question has nothing left to do and no frame to wait for.

---

## Off-topic answers

Agreed, nothing to change. We render them and count them; we never score
anything.

---

## What we need from you

1. **What does `skip_question` put on the wire?** Specifically, does
   `answer_recorded` for a decline carry a `display` (e.g. "Skipped"), a
   `choice`, both or neither. Our readback is the only thing that shows a
   candidate what was recorded, and a decline with an empty frame is the one
   record still invisible to them.
2. **`references/voice-test.html`**, still — a known-good rev-6 client is the
   fastest way to settle "is it us or you" on the next one of these.
3. **The `introduction` field is built from the cosmetic caption channel, and we
   can now show you.** This was our open question from v7.1; a live payload
   answers it:

   ```
   "introduction": "…recruiter a based application.Yes.Don't have any interest
   on that. application but I have to do that."
   ```

   `application.Yes.Don't` — the fragment separators are lost, exactly as in the
   stuttering captions we reported in August. **We now render this field** (its
   own "Tell me about yourself" card at the top of the report's Questions tab,
   badged _not scored_), so it is in front of recruiters rather than discarded.
   We put the sentence spaces back for display — whitespace only, no word
   altered — but this is the candidate's own voice in a document a hiring
   decision is made from, and it should not be arriving welded together. Please
   either emit the separators or build this field from something other than the
   channel you have declared cosmetic.

4. **What language is the STT pinned to?** On a run in August a candidate spoke
   English on question 7 and `answer_recorded.transcript` came back as Telugu,
   and Elena reasonably answered what she had received. Now that captions are
   cosmetic this matters less for choices — but a free-text answer is graded on
   that channel.

---

## Where this lives in our code

| Change                                                                           | File                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `clientMayAdvance` — no automatic `next` on `mcq`/`likert`, with the reasoning   | `src/features/interview/use-voice-interview.ts`          |
| one automatic `next` per question                                                | same, the silence interval                               |
| `next N — candidate` / `— clock` in the trace                                    | same, `advance()`                                        |
| the 100 ms connect settle, and the one-socket note                               | same, the socket effect                                  |
| `connecting #N — …` / `ready on socket N`                                        | same                                                     |
| the "Heard you — Elena is recording that" line, and the readback                 | `src/features/interview/voice-room.tsx`                  |
| `completeAllRecorded` — the client's own completion, and the `end` frame with it | `src/features/interview/use-voice-interview.ts`          |
| `finishLocked`, and "finishing your interview…"                                  | `src/features/interview/voice-room.tsx`                  |
| the introduction card, and `readableTranscript`                                  | `src/features/dashboard/pages/interview-result-page.tsx` |
| the `introduction` field, plumbed through                                        | `src/services/hr/interviews.ts`                          |

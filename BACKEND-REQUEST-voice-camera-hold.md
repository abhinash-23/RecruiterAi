# Voice interview — one new frame: pause while the camera can't see the candidate

**To:** backend team
**Re:** `WS /api/voice/{session_id}`, protocol `rev: 6`
**Asks:** one client→server frame, one server→client notice
**Status on our side:** done as far as the protocol allows. This is the part
that isn't ours to fix.

---

## The situation

The sitting is proctored. When the camera stops seeing the candidate's face, the
client **mutes the microphone** — that is deliberate and not negotiable: this
socket is live, everything Elena hears is transcribed and scored, and an answer
spoken by somebody off camera must not become a recorded answer.

Elena, meanwhile, carries on. She finishes the question, hears silence (we send
silence frames, per your §3 — never dropped), the check-in fires, and then the
75 s net advances. From the candidate's chair:

> the screen says "we can't see you — nothing you say now is recorded", and
> underneath it the transcript fills up with questions 12, 13 and 14 going by.

Every one of those is recorded against them as an answer they never gave, on a
question they never heard. It was reported to us in exactly one sentence: _"when
the camera is off, don't ask any question."_

## What we have already done

**Elena's audio is held, not muted.** We suspend the playback `AudioContext` for
the duration, so her voice keeps its place in the queue and plays from where it
stopped once the candidate is back in frame. She asks the question once, to
somebody who can answer it. The room says "Elena is paused" rather than only
mentioning the mute.

That closes the common case completely — a few seconds out of frame, someone
leaning out of shot to check a monitor — and it is a genuine improvement.

## What we cannot do

**Stop you advancing.** The protocol gives the client four frames — `auth`,
`select`, `next`, `end` — and none of them means "wait". Your check-in and your
75 s safety-net advance are timers measured from the end of _her_ audio, so:

- a face lost for more than ~75 s burns the question regardless of anything we
  do;
- and holding her audio makes our position _slightly worse_ in that case, since
  the question the server has moved past is one we deliberately haven't played.

We are not going to send `next` to paper over this — it would record a wrong
answer on purpose — and we are not going to stop sending audio frames, because
your §3 is explicit that suppressed frames go as silence.

## The ask

**1. A client→server `pause` / `resume` frame.**

```jsonc
{ "type": "pause",  "reason": "camera" }   // client → server
{ "type": "resume" }                       // client → server
```

While paused, we would expect the backend to:

- **not advance the question** — hold the check-in timer and the 75 s net;
- **not record an answer** for the question in flight;
- leave Elena's turn state alone, so `resume` continues the same conversation
  rather than restarting or re-greeting;
- keep the socket and the Gemini leg up exactly as they are today.

`reason` is there so your log says why, and so you can decide policy per reason
later (camera lost, tab hidden, the candidate stepping away). We only need
`"camera"` now.

**2. A cap you own, not us.**

A pause is a proctoring hole if it can be held indefinitely — a candidate could
cover the camera and stop the clock. So the cap belongs on your side, where the
sitting's clock already lives:

```jsonc
{ "type": "notice", "code": "pause_expired", "seconds": 120 }
```

…after which you resume on your own and carry on as you do today. We will show
that to the candidate. **Please do not make the pause stop the interview's
overall time limit** — the sitting's deadline should keep running, or covering
the camera becomes free extra time.

## Why this is worth a frame

The alternative is what happens now: a proctoring rule and the interview flow
working against each other, with the candidate's score paying for it. Muting the
microphone off camera is the right call. Recording silence as their answer while
we do it is not, and it is the only outcome available to us without this.

## What we need back

1. Whether `pause` / `resume` is something you will add, and roughly when — we
   will keep the audio hold either way, it is strictly better than nothing.
2. If not: does the 75 s net or the check-in have _any_ condition we can
   influence from the client? If either can be reset by something we already
   send, say which and we will use it.
3. Confirmation of the cap you would pick, so our copy tells the candidate the
   right number rather than a guess.

## Related, still open from 2026-09-07

`BACKEND-REPLY-voice-2026-09-07.md` is the current thread and has four questions
outstanding — chiefly what `skip_question` puts on the wire, and whether
`interview_complete` is sent when the last answer is recorded (we now finish the
sitting ourselves after 8 s if it isn't).

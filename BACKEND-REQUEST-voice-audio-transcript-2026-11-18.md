# Voice interview: interviewer audio breaking up, and transcript problems

**Date:** 2026-11-18
**From:** frontend
**About:** three problems seen in real rev-7 voice interviews. All three need a look at the server side.

| # | Problem | How often |
|---|---|---|
| 1 | The interviewer's voice breaks up mid-sentence | 2–3 times per interview |
| 2 | Several candidate answers appear as one transcript line | Seen in the introduction |
| 3 | The transcript stops showing the interviewer's questions and the spoken answers partway through | Seen in session `3c371298-fa0`, from about question 13 of 30 |

---

## 1. The interviewer's voice breaks up

**What the candidate hears:** the interviewer's voice breaks 2–3 times in one interview, in the middle of a sentence.

### How the frontend plays her audio (rev 7)

- Each audio chunk is scheduled to start exactly where the previous one ends, so a steady stream plays without gaps.
- If the next chunk hasn't arrived when the queued audio runs out, there is **silence until it arrives**. Playback then restarts 80 ms after that chunk lands.
- On `interrupted`, every playing and queued chunk is **stopped at once**, as the guide requires. She is cut off mid-word.

So a break the candidate hears has one of two causes, and both start on the server side.

### Possible cause A: gaps in the audio stream

Her audio arrives late in the middle of a turn, so the queue runs dry. That can happen:
- between Gemini and the backend;
- in the backend's own buffering before it sends chunks to the socket;
- on the network path: Cloud Run, or the **ngrok tunnel** when testing against the ngrok backend. A free tunnel adds jitter.

Our nginx proxy has buffering off for the voice socket, so it doesn't hold chunks back.

### Possible cause B: an `interrupted` the candidate didn't cause

On rev 7 the server decides when she has been interrupted, and the frontend obeys every `interrupted` frame. If the server's turn detection triggers when the candidate didn't speak, she is cut off. Possible triggers:
- echo of her own voice from laptop speakers;
- a cough;
- background noise.

### What we will send you

For each sitting where it happens:
- the **session id**;
- the **frame log**, exported from the candidate's tab with Ctrl+Shift+Alt+L. It records every JSON frame with a timestamp, including each `interrupted`, so it shows cause B directly. It contains none of the spoken text.
- the **`client_info`** frame, which you already receive: the browser, mic settings and audio context state.

The frame log does **not** record individual audio chunks, so it can't show cause A on its own.

### What we need from you

1. **For the session ids we send, check `interrupted` in your trace.** Was it sent at the moments the voice broke? What triggered it: candidate speech, noise, or her own echo?
2. **Check the audio delivery timing** for those sessions. Within one interviewer turn, are there gaps between consecutive audio chunks of more than about 200 ms? Are chunks ever batched and sent late?
3. **Tell us if you want playback reports.** We can add two things on our side:
   - a frame-log line each time her audio runs out mid-turn;
   - optionally, a small frame back to you (e.g. `{"type":"playback_gap","ms":340,"at":…}`), so the gaps show up in your trace next to your send times.

   Say which you'd like, and the field names if it's the frame.

---

## 2. Candidate answers merge into one transcript line

**What we saw:** during the introduction, the candidate answered three of the interviewer's questions. The transcript showed **one** candidate bubble containing all three answers, placed after her first question. Her second and third questions appeared below it, with no answers between them.

**Why:** the frontend shows one bubble per transcript `id`. It updates a bubble in place when the same `id` arrives again with more text, and sorts bubbles by `id`. The three answers arrived under **one `id`**: the line kept growing and was never sent with `final: true`. The frontend can't split them, because it only merges text that arrives under the same `id`.

### What we need from you

1. **A new `id` for each candidate turn**, including in the introduction.
2. **`final: true` when the candidate's turn ends**, before the interviewer's next line, as in the rev-7 guide.
3. **One question from our rev-7 reply is still open.** On option questions we sometimes see both the candidate's spoken words ("Suggest individuals take on their own tasks.") and a separate "A. Suggest that individuals…" line. When the candidate answers an option question, does the server send a transcript line for the recorded answer? If it does, tell us and we'll stop writing our own line for taps, so the answer isn't shown twice.

---

## 3. The transcript stops showing new lines partway through

**What we saw** (session `3c371298-fa0`, at question 23 of 30, with 22 answers recorded):
- The bottom of the transcript showed **only** the candidate's tapped option answers ("B. Create time blocks…", "A. Challenge the criticisms…").
- **None** of the interviewer's questions appeared, and none of the spoken answers to open questions, for roughly the last 10 questions.
- The recruiter's live page and the results showed all of those questions and answers correctly. Only the candidate's transcript was missing them.

**Why only tapped answers still show:** on rev 7 the frontend draws the transcript from your `transcript` frames alone. The one line it writes itself is a tapped option's answer, which it places just after the **highest line `id` it has received**. So tap lines keep appearing at the bottom, but anything that depends on your frames has stopped appearing there.

That leaves two explanations. Both are on the server side.

**A. The line `id`s restarted mid-interview,** for example after the server's Gemini session reconnected.
- The frontend keeps one bubble per `id` and updates it in place when that `id` arrives again.
- New lines numbered 1, 2, 3… therefore **overwrote old bubbles at the top** of the transcript instead of being added at the bottom.
- An `id` that comes back for the other speaker even keeps the old bubble's speaker label.

**B. `transcript` frames stopped being sent** partway through, for example because transcription wasn't re-enabled on the new Gemini session after a reconnect.

The frame log from that tab tells which: it records each `transcript` frame's `id` and `final` flag, with timestamps (no spoken text). We'll send it with the session id.

### What we need from you

1. **Line `id`s unique and increasing for the whole sitting.** Never reset them, including across a Gemini reconnect, a resume, or a new round. A higher `id` must always mean a later line.
2. **Keep sending `transcript` frames for both speakers until `interview_complete`,** including after any reconnect. If transcription is set up per Gemini session, it needs to be set up again on every new session.
3. **Check session `3c371298-fa0` in your trace:**
   - Was there a Gemini reconnect around question 13?
   - What `id`s did the `transcript` frames carry after it?
   - Did any `transcript` frames go out after it at all?

---

## Already fixed on the frontend

The transcript panel sometimes didn't scroll to the newest line. That was a frontend bug, fixed in commit `d8674c4` on 2026-11-17. It needs nothing from you. It happened when an earlier line filled in after the interviewer's next line had appeared.

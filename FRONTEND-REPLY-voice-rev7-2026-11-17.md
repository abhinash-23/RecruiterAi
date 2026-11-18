# Voice interview, protocol rev 7: frontend reply

**Date:** 2026-11-17
**Replying to:** _Voice Interview — Frontend Implementation Guide_ (2026-11-16, protocol revision 7)
**Status:** built and tested against a mocked socket. **Not deployed yet.** Nothing has been run against a real rev-7 backend, since `feat/voice-settings` isn't merged.

---

## How we switched

The client reads `rev` from `ready`.

- **`rev >= 7`:** the client follows your guide. It stops doing turn-taking itself.
- **`rev < 7`, or no `rev`:** the client keeps every workaround older backends rely on.

So this build is safe to ship **before** you deploy rev 7. It changes behaviour only once `ready` says `rev: 7`. If you bump the number again, everything at 7 and above keeps the rev-7 behaviour.

## The six "do these first" items

| # | Your ask | On rev 7 now |
|---|---|---|
| 1 | Stop playback at once on `interrupted` | Every scheduled and playing source is stopped and the queue cleared on the same tick, with no fade. `nextStartTime` resets to now. Two `interrupted` frames in a row are harmless. We send nothing back. **We removed our own barge-in detection**: we no longer stop her when the mic is loud. |
| 2 | Play her audio as it arrives, at normal speed | `startAt = max(cursor, currentTime + 0.08)`, then `cursor = startAt + duration`. So 80 ms is the only lead, and only when the queue has run dry. There's no speed change and there are no effects. **Removed:** pausing her audio when the camera loses the candidate's face, and dropping queued audio older than 2.5 s when a new `question` arrives. One player is kept for the whole sitting. |
| 3 | Transcript from `transcript` frames, one bubble per `id` | Done. We create or replace by `id`, sort by `id` (never by arrival), and replace the "—" line after an interruption. "Hearing" is the newest `candidate` line with `final: false`. `caption` frames are no longer rendered, but we still use them as a "someone is talking" signal. Lines are labelled with `voice_host.name`. |
| 4 | Continuous 16 kHz mono PCM16, 20–40 ms chunks, echo cancellation on | 512-sample frames (32 ms, 1,024 bytes), posted from the AudioWorklet as soon as each fills. **Removed:** the gate that sent silence while she spoke unless the mic was loud, and the up-to-768 ms "pre-roll" we held back. |
| 5 | Send `next` only on Done | Done. **The silence timer that sent `next` after 6–12 s of quiet on open questions is off on rev 7.** Option questions already never auto-advanced. |
| 6 | Show nothing about the plumbing | Reconnects show **"One moment…"**, never "reconnecting". `host_silent` shows nothing. A voice failure moves to the typed interview with **"Let's continue in writing. Everything you've answered so far is saved."** No notice or error codes appear as text. The session stays open until `interview_complete`. |

### Also changed, on every revision (not only 7)

- **The AudioContexts now run at the device's own rate.** Before, the mic context was forced to 16 kHz and the player to 24 kHz. This follows your Firefox echo-canceller note.
- **New resampler in the mic worklet.** Before, it used linear interpolation, which aliases. Now it's a windowed-sinc (Blackman) low-pass resampler: 8 zero crossings each side, a 7.2 kHz cut-off, and about 0.6 ms of added latency.
  - Measured on synthetic tones at 48 kHz and 44.1 kHz input: 1–3 kHz passes at full level, and an 11 kHz tone (which used to alias to 5 kHz) comes out at 0.
- **Mic constraints:** `echoCancellation`, `autoGainControl` and `channelCount: 1` are always on.
  - `noiseSuppression` is on by default, behind a build-time switch: `VITE_MIC_NOISE_SUPPRESSION=false`. Tell us when you want an "off" build for the comparison.
- **The microphone is re-acquired with the same constraints if its track ends.** It's wired into the same worklet, so the socket never notices.
- **Wording:**
  - "Listening — take your time." replaces "Listening. Just answer out loud."
  - The pre-interview screen now says the host is **"an AI interviewer"** and suggests headphones.
  - We do **not** say a person reviews the result; that's a statement for each customer.
- **`client_info` is sent once**, after the mic opens. See the answer to question 1 for its fields.

## Answers to "What we need from you"

**1. `getUserMedia` constraints and what `getSettings()` reports**

We ask for `echoCancellation: true`, `noiseSuppression: true`, `autoGainControl: true` and `channelCount: 1`, plus a `deviceId` if the candidate picked a device on the device check.

We haven't collected per-browser `getSettings()` output yet. From this build on, every sitting sends it to you in `client_info`:

```json
{
  "type": "client_info",
  "mic": { "echoCancellation": true, "noiseSuppression": true, "autoGainControl": true,
           "sampleRate": 48000, "channelCount": 1, "deviceLabel": "…" },
  "capture": { "contextSampleRate": 48000, "sendRate": 16000, "chunkMs": 32,
               "chunkBytes": 1024, "resampler": "worklet windowed-sinc …" },
  "player": { "contextSampleRate": 48000, "contextState": "running", "wireRate": 24000,
              "startLeadMs": 80, "output": "page output (AudioContext.destination)" },
  "browser": "<user agent>",
  "revSeen": 7,
  "micMode": "continuous"
}
```

The same object goes to the browser console with the session id. Please store it with the session trace as the guide proposes. It answers questions 1–3 for every real sitting, not just our test machines.

**2. How the microphone is captured and sent**

An AudioWorklet, with no timers and no ScriptProcessorNode. 512 samples at 16 kHz (32 ms) per binary frame, each sent as soon as it's full. The context runs at the device rate, and the worklet resamples to 16 kHz as described above.

**3. How her audio is played**

- **Scheduling:** see item 2 in the table. No jitter buffer beyond the 80 ms lead.
- **Context:** runs at the device's rate. The 24 kHz `AudioBuffer`s are resampled by the browser.
- **Output:** plays through `AudioContext.destination`, so it is the normal page output.
- **On `interrupted`:** every source is stopped and the queue cleared.
- **When the context is created:** when the socket connects, which is after the candidate's click on Start. It isn't created inside the click handler itself.
  - Chrome lets it run because the page has had a user gesture.
  - Safari lets it run because the page is capturing the camera and mic.
  - We also resume it on every chunk if it's found suspended.
  - `player.contextState` in `client_info` shows whether it was running.
  - If you see `suspended` there, tell us and we'll move creation into the click itself.

**4. Does the client send `next` on its own? What does Done send?**

- **Rev 7:** never. Done sends `{"type":"next","index":<latest question index>}`, or `index: -1` to skip the introduction.
- **Rev 6 and older:** a silence timer still sends `next` on **open** questions, after 6 s, or 12 s when your check-in is live. It never does so on option questions.

**5. What does Mute do?**

It sends zero-filled frames at the same 32 ms cadence and never stops sending. The same happens while the camera can't see the candidate.

**6. How did `caption` frames become bubbles?**

You were right. A new bubble started when the speaker changed, plus heuristics: a 2 s gap, a sentence end followed by 0.7 s, and stitching overlapping fragments. That's all bypassed on rev 7.

**7. Which notices were shown as text?**

- `reconnecting` showed "<host> is reconnecting…".
- `host_silent` (and our own 5 s wait) showed "<host> is joining…".

Both are now one neutral line, "One moment…". Nothing else was ever shown, and every notice is logged.

**8. What a soft-skill question shows**

The scenario, the question and the tappable options are all on screen for as long as the question is open. The Likert scale stays visible for every rating question. After `answer_recorded`, we briefly show "Recorded: <display>", never a score.

**9. Browsers and devices**

We don't collect this today. `client_info.browser` will give you the user agent per session from now on. Anecdotally, testing has been mostly desktop Chrome.

**10. A timestamped frame log, downloadable by session**

It already exists. The browser keeps an always-on log of the last 10 minutes of the voice socket: every JSON frame in and out, with timestamps, plus our trace lines. It survives a reload.

- **Export:** run `raExportFrameLog()` in the console, or press Ctrl+Shift+Alt+L.
- **What's left out:** anything anyone said, i.e. transcript text, options and answers. Binary audio frames aren't logged individually.

If you want it uploaded to you automatically at the end of a sitting, propose an endpoint and we'll wire it.

**11. Echo check per browser**

Yes, as soon as rev 7 is deployed somewhere we can reach. We'll run laptop speakers with nobody speaking for a full question on Chrome, Firefox and Safari, and send you the session ids.

## What we need from you

1. **Tell us when rev 7 is on a URL we can test against.** Nothing here has met a real rev-7 server. Your test checklist is our acceptance list, and we'll run all of it.
2. **Tapped answers in the transcript.** A tap makes no sound, so we write the candidate's line ("B. Talk privately") locally and sort it just after the newest server line. Does rev 7 send a `transcript` line for a tap? If it does, we'll stop writing ours to avoid a duplicate.
3. **The goodbye before `interview_complete`.**
   - Once every answer is recorded, we wait up to 20 s for `interview_complete` (we used to wait 8 s). After that, we finish the sitting ourselves with `end`.
   - When `interview_complete` arrives, we let the queued goodbye finish playing (capped at 15 s) before the done screen closes the socket.
   - Tell us if the goodbye can take longer than 20 s from the last `answer_recorded`.
4. **The camera-hold request still stands.** On rev 7 we no longer hold her audio when the candidate leaves the frame, because a held context breaks your playback estimate. The mic still goes silent, but she can ask a question into an empty room again. The fix needs a server-side `pause`/`resume` frame, as in our earlier camera-hold request.
5. **Playback reports:** yes, we're happy to send a played-seconds frame about once a second when you specify it. `queuedSeconds()` already exists on our side.

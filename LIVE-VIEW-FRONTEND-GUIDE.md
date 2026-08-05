# Live Interview Viewing — Frontend Integration Guide

**For:** the frontend team, implementing Phase 2 of live viewing.
**Backend status:** done. The signaling WebSocket (`WS /api/live/{interview_id}`) is live and tested. This guide is everything you need to build the browser side; you do **not** need to read the backend code.

If you've never done WebRTC, read the "Mental model" section first — it's 90% of the confusion.

---

## Mental model (read this first)

- The **video/audio goes directly browser → browser.** It does **not** go through our server. Our server is only a "switchboard" that passes small text messages so the two browsers can find each other.
- Those text messages are the **signaling handshake**: an `offer`, an `answer`, and some `ice` (network address) messages. You send/receive them over our WebSocket. The browser's `RTCPeerConnection` object generates and consumes them — you mostly just shuttle them back and forth.
- **Two roles:**
  - **Candidate = publisher.** Has the camera/mic. **Creates the offer.**
  - **HR/Admin = viewer.** Has no camera. **Answers the offer** and displays the incoming video.
- One candidate can be watched by several viewers at once. The candidate keeps **one `RTCPeerConnection` per viewer**, keyed by the viewer's `peer` id that the server assigns.
- **STUN** is a free public helper that tells each browser its own public address. That's the only external piece, and it's free.

---

## What you're given

| Thing | Where it comes from |
|---|---|
| `interviewId` | you already have it (the interview the candidate is sitting / the HR opened) |
| **candidate token** | the `candidate_token` field from the `POST /api/verify-otp` response (candidate already has this during the sitting) |
| **staff bearer token** | the `token` from `POST /api/auth/login` (HR/admin already logged in) |
| WebSocket URL | `wss://<your-api-host>/api/live/{interviewId}` (use `wss://` in production, `ws://` locally) |
| STUN server | `stun:stun.l.google.com:19302` (free, no credentials) |

---

## The message contract (what travels over the WebSocket)

```
// you send first, once:
{type:"auth", role:"candidate"|"viewer", token:"..."}

// server replies:
{type:"auth-ok", role, ...}      // success
// ...or the socket closes with a code: 4001 bad token · 4404 not found/not yours
//    · 4409 candidate already streaming · 4403 bad origin · 4400 malformed

// server tells you when the other side joins/leaves:
{type:"peer-joined", role, peer?}    {type:"peer-left", role, peer?}

// the WebRTC handshake (relayed between the two peers):
{type:"offer",  sdp, peer}    {type:"answer", sdp, peer}    {type:"ice", candidate, peer}
```

**`peer` rule:** a **viewer omits `peer`** when sending (there's only one candidate; the server tags it). The **candidate must set `peer:<viewerId>`** when sending, to target a specific viewer.

---

## Reference code — CANDIDATE (publisher)

```js
const STUN = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

async function startPublishing(interviewId, candidateToken, localStream) {
  // localStream = the MediaStream you already got from getUserMedia for the
  // camera. You can reuse the same stream the vitals capture uses.
  const ws = new WebSocket(`wss://YOUR_HOST/api/live/${interviewId}`);
  const peers = new Map(); // viewerId -> RTCPeerConnection

  ws.onopen = () =>
    ws.send(JSON.stringify({ type: "auth", role: "candidate", token: candidateToken }));

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === "auth-ok") {
      // any viewers already waiting → offer to each
      for (const vid of msg.viewers || []) await makeOfferTo(vid);
      return;
    }
    if (msg.type === "peer-joined" && msg.role === "viewer") {
      await makeOfferTo(msg.peer);
      return;
    }
    if (msg.type === "peer-left" && msg.role === "viewer") {
      peers.get(msg.peer)?.close();
      peers.delete(msg.peer);
      return;
    }
    // answer / ice coming back from a specific viewer
    const pc = peers.get(msg.peer);
    if (!pc) return;
    if (msg.type === "answer") await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
    if (msg.type === "ice")    await pc.addIceCandidate(msg.candidate);
  };

  async function makeOfferTo(viewerId) {
    const pc = new RTCPeerConnection(STUN);
    peers.set(viewerId, pc);
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    pc.onicecandidate = (e) => {
      if (e.candidate)
        ws.send(JSON.stringify({ type: "ice", candidate: e.candidate, peer: viewerId }));
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", sdp: offer.sdp, peer: viewerId }));
  }

  return ws; // close it when the interview ends
}
```

---

## Reference code — HR / ADMIN (viewer)

```js
const STUN = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function watchInterview(interviewId, staffToken, videoEl, onUnavailable) {
  const ws = new WebSocket(`wss://YOUR_HOST/api/live/${interviewId}`);
  let pc = null;

  ws.onopen = () =>
    ws.send(JSON.stringify({ type: "auth", role: "viewer", token: staffToken }));

  ws.onclose = (e) => { if (e.code === 4404) onUnavailable("Not authorized"); };

  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);

    if (msg.type === "auth-ok") {
      if (!msg.candidateOnline) onUnavailable("Candidate is not live yet");
      return; // we wait for the candidate's offer
    }
    if (msg.type === "peer-left" && msg.role === "candidate") {
      onUnavailable("Candidate left");
      pc?.close(); pc = null;
      return;
    }
    if (msg.type === "offer") {
      pc = new RTCPeerConnection(STUN);
      pc.ontrack = (e) => { videoEl.srcObject = e.streams[0]; }; // show the video
      pc.onicecandidate = (e) => {
        if (e.candidate) ws.send(JSON.stringify({ type: "ice", candidate: e.candidate }));
      };
      pc.onconnectionstatechange = () => {
        if (["failed", "disconnected"].includes(pc.connectionState))
          onUnavailable("Live connection lost — use the recording");
      };
      await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: "answer", sdp: answer.sdp })); // no peer — server tags it
      return;
    }
    if (msg.type === "ice" && pc) await pc.addIceCandidate(msg.candidate);
  };

  return ws;
}
```

HR page: one `<video autoplay playsinline></video>` element passed in as `videoEl`, plus an "unavailable" banner driven by `onUnavailable`.

---

## The fallback (required, not optional)

STUN-only connects ~80–90% of the time. On restrictive networks (some corporate/campus/mobile) the direct connection can't form. **This is expected.** Handle it:

- When `pc.connectionState` becomes `failed` or `disconnected`, or you never get video within ~10–15 s, call `onUnavailable(...)` and show "Live view unavailable — the recording will be available after the interview."
- The recording flow already exists (see API doc §9.4 / recordings endpoints). Live viewing is a bonus on top of the guaranteed recording; never block the interview on it.

---

## Consent (must ship before the publisher side goes live)

The candidate currently consents to recording + analysis. Add one line to the consent screen: **"A recruiter may view your interview live."** The candidate must see this before their camera is published to a viewer. This is the frontend's consent copy — no backend change needed, but it is a hard requirement.

---

## How to test without a real interview

1. Open two browser tabs pointed at a test page.
2. Tab A: run the candidate script with a real `candidate_token` (from a `verify-otp` call) and a `getUserMedia` stream.
3. Tab B: run the viewer script with a real staff `token` for an HR who owns that interview.
4. Tab B's `<video>` should show Tab A's camera within a couple of seconds.
5. Try Tab B with a *different* company's HR token → the socket closes with code `4404` (the ownership wall).

Local dev note: use `ws://` (not `wss://`) against `http://127.0.0.1:8080`, and make sure your dev origin is in the backend's `CORS_ALLOW_ORIGINS` (the WebSocket checks Origin too).

---

## Checklist to hand off

- [ ] Candidate page: publish `getUserMedia` stream via the candidate script (reuse the camera stream already opened for vitals).
- [ ] HR/Admin page: "Watch live" button → viewer script → `<video>` + unavailable banner.
- [ ] STUN config exactly as above (free, no credentials).
- [ ] Fallback to recording on connection failure/timeout.
- [ ] Consent line added.
- [ ] Use `wss://` in production; dev origin in `CORS_ALLOW_ORIGINS`.

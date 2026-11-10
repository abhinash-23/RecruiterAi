# Production deployment: what the backend needs

**Date:** 2026-11-05
**From:** frontend
**Backend:** `https://recruiterai-backend-100366934313.northamerica-northeast1.run.app` (Cloud Run, `northamerica-northeast1`)
**Status:** the frontend is ready to deploy. The new backend is healthy. Live video (#2) is the one blocker left, and #3 and #4 must be done before go-live.

---

## Summary

| #   | Item                                                                                 | Priority                 |
| --- | ------------------------------------------------------------------------------------ | ------------------------ |
| 1   | Capacity settings, so the 429 "Rate exceeded" seen on the old backend doesn't repeat | 🔴 Must check            |
| 2   | Live view gets progress but never video (`stream-offline`)                           | 🔴 Blocker for live view |
| 3   | Cloud Run request timeout must be `3600` (WebSockets)                                | 🔴 Must                  |
| 4   | Invitation links must use the production frontend domain                             | 🔴 Must                  |
| 5   | Asset URLs in responses must be relative (`/api/...`) or `https://`                  | 🟡 Should                |
| 6   | Every error from the app must be JSON, including 500s                                | 🟡 Should                |
| 7   | Confirm limits: 25 MB request body, answer in under 300 s                            | 🟡 Should                |
| 8   | `/api/health` as the probe: cheap and not rate-limited                               | 🟡 Should                |
| 9   | Audit log entries: add an `id`                                                       | 🟢 Nice to have          |

---

## Health check results (2026-11-05)

| Backend                                                                     | `GET /api/health`                                                           | WebSocket handshake (`/api/live-relay/…`) |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------- |
| **New:** `recruiterai-backend-100366934313.northamerica-northeast1.run.app` | ✅ `200` JSON: `version 3.5-PG`, `app_env production`, `database connected` | ✅ `101 Switching Protocols`              |
| Old: `recruiterai-backend-610993990979.us-east4.run.app`                    | ❌ `429 text/html "Rate exceeded."` (also `503`)                            | not tested                                |

**The frontend now points at the new backend.** If the old us-east4 service is no longer used, please shut it down so nobody points at it by mistake.

---

## How production traffic reaches you

```
Browser ──https──▶ Frontend (Cloud Run, nginx) ──https──▶ recruiterai-backend (Cloud Run, northamerica-northeast1)
                   same origin: /api/*                     https://recruiterai-backend-100366934313.northamerica-northeast1.run.app
```

- **The browser never calls the backend directly.** Every `/api/...` call goes to the frontend's own domain, and nginx forwards it.
- **The path is not rewritten.** `/api/auth/login` arrives as `/api/auth/login`.
- **Headers nginx sets:**
  - `Host`: your service's own hostname.
  - `X-Forwarded-For`: the client's IP.
  - `X-Forwarded-Proto`: the client's real protocol, always `https`.
  - `Upgrade` and `Connection`: for WebSockets.
  - It also sends `ngrok-skip-browser-warning: true`, a leftover from the ngrok tunnel days. Ignore it.
- **Proxy timeouts:**
  - 300 s for normal requests.
  - 3600 s for the WebSocket routes: `/api/live-relay/*`, `/api/recordings/stream/*`, `/api/voice/*`, `/api/live/*`.
- **Maximum request body:** 25 MB.
- **The backend target is a runtime setting.** It's `API_PROXY_TARGET` on the frontend service, so a backend URL change needs no rebuild.

---

## 1. 🔴 Capacity settings: don't let "Rate exceeded" happen again

**What happened.** The old us-east4 backend answered every request with Cloud Run's `429 "Rate exceeded."` and `503`, even `/api/health`. The new backend is fine today. Please check that it can't end up the same way.

The 429 is **Cloud Run's own response**, not your app's: the body is plain text and not your JSON. Cloud Run sends it when no instance can take the request. That happens when:

- max instances are all busy at their concurrency limit;
- instances crash or fail to start;
- instances never become ready.

**Why this app hits it easily.** On Cloud Run, an open WebSocket is a request in flight for its whole life, and it holds one concurrency slot for up to an hour.

- One interview holds **2 sockets**: the recording upload and the voice socket.
- Each recruiter watching it holds **1 more**.

With a low `containerConcurrency` (for example 1–10) and a low max-instances, a handful of live interviews fill all capacity. Then every other request, logins included, gets a 429.

**Check these on the new service:**

```bash
gcloud run services describe recruiterai-backend --region northamerica-northeast1 \
  --format="yaml(spec.template.metadata.annotations,spec.template.spec.containerConcurrency,spec.template.spec.timeoutSeconds)"

gcloud run services logs read recruiterai-backend --region northamerica-northeast1 --limit 200
```

- **`autoscaling.knative.dev/maxScale`** (max instances): is it too low?
- **`containerConcurrency`:** for an async FastAPI/uvicorn app, the default of **80** or higher is normal. A value of 1 means one request, or one socket, per instance.
- **Logs:**
  - out-of-memory kills (`Memory limit ... exceeded`);
  - crash loops;
  - failed startup probes.
- **Recommended:**
  - `--min-instances=1`, so the first candidate of the day doesn't wait for a cold start;
  - `--no-cpu-throttling`, if anything runs after the response is sent (for example the Resume analysis queue). Otherwise Cloud Run takes the CPU away mid-task.

---

## 2. 🔴 Live view: progress arrives, video never does

**Symptom.** A recruiter opens the live page during a real sitting:

- **Progress frames arrive:** the page shows "Answered 3", "Q 4/22", and so on.
- **The relay never delivers video:** it sends `stream-offline` and never any binary frames.
- **Result:** the page stays on "Waiting for the candidate to start their interview."

This was seen on the old backend. **Please test it on the new one;** the cause below applies to any Cloud Run service.

**Most likely cause: more than one backend instance.**

- Progress comes from the **database**, which every instance shares.
- The video bytes are **relayed in memory**. They go from the candidate's upload socket (`WS /api/recordings/stream/{id}`) to the viewers' sockets (`WSS /api/live-relay/{id}`).
- With more than one instance running, the two sockets can land on different instances. The viewer's instance has no bytes, so it reports `stream-offline` forever.
- **Session affinity does not fix this.** Affinity follows one browser's cookie, and these are two different browsers: the candidate's and the recruiter's.

**How to confirm.** For one interview, log the instance ID when each socket connects. You can get it from the metadata server, `instance/id`. If they differ, this is the cause.

**Fix options:**

| Option                                                                                                                                                    | Notes                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **a. Shared pub/sub between instances** (for example Memorystore Redis pub/sub, keyed by interview ID; cache the init segment so a late viewer can start) | The proper fix.                                                                           |
| **b. `--max-instances=1`**                                                                                                                                | A stopgap only. It brings back the #1 risk unless concurrency is raised a lot.            |
| **c. Viewer reads from storage** (GCS) with a few seconds' delay                                                                                          | Simpler, but adds delay. The UI already promises nothing "real-time" (1–3 s is expected). |

**Check other in-memory state too.** The same problem applies to anything kept in memory per interview:

- the voice session behind `/api/voice/{session_id}`;
- the recording upload's ack/resume offsets;
- relay buffers.

A reconnect landing on a different instance loses all of it.

**The frontend side is not the cause.** Recording and playback were verified end to end. To trace the sockets in a browser:

```js
localStorage.setItem("ra:trace", "1") // then reload; every socket frame is logged
```

---

## 3. 🔴 Cloud Run timeout: 3600 seconds

```bash
gcloud run services update recruiterai-backend --region northamerica-northeast1 --timeout=3600
```

**Cloud Run's request timeout also limits WebSockets.** The default is 300 s, which cuts a live interview, its recording upload and the recruiter's live view at **5 minutes**. 3600 s is Cloud Run's maximum, and we set the same on the frontend service.

**Clients reconnect, but only to the instance they land on.** The upload resumes from its byte offset and the viewer rejoins, but #2 applies to every reconnect.

---

## 4. 🔴 Invitation links must point at the production frontend

Invitation emails, and the `interviewLink` in schedule responses, carry links like `https://…/#/otp?interview_id=…`.

- **The host must be the production frontend domain.** Not ngrok, not `localhost`, not the backend's `run.app` URL.
- **Please make it a config value** on the backend service. We'll send you the final domain.
- **Both link forms work.** The frontend accepts `/#/otp?…` and `/otp?…`.

---

## 5. 🟡 Asset URLs: relative, or `https://`

**Return relative paths for logos and profile pictures.** Return `/api/branding/logo?...`, as today, not absolute URLs. The reasons:

- **An `http://` URL is blocked.** On the https site the browser treats it as mixed content, and the picture doesn't load. This has happened before.
- **An absolute URL to your `run.app` host is cross-origin.** The frontend fetches profile pictures **with the bearer token**, and a cross-origin fetch with a token needs CORS, which production otherwise doesn't need (see "CORS" below).

**If something must be absolute,** run uvicorn with `--proxy-headers --forwarded-allow-ips="*"` so `request.url_for(...)` comes out as `https://`.

---

## 6. 🟡 Errors: always JSON

**What the frontend reads from an error:**

- `detail`: a string, or FastAPI's validation list, where it takes the first `msg`;
- or `message`;
- and an optional machine-readable `code` (for example `"time_up"`).

**Please make sure:**

- **Unhandled exceptions return JSON.** Use a global exception handler that returns `{"detail": "..."}` with a 500, not an HTML or plain-text traceback.
- **Your own 429s are JSON and include `Retry-After`.** These are the OTP and resend limits.

Platform-level errors (Cloud Run's `Rate exceeded.`, and nginx's 502/504) can't be JSON. **As of this release, the frontend shows those to users as readable messages** like "The server is busy right now." Before, users saw a technical error.

---

## 7. 🟡 Limits to confirm

| Limit              | Value                                                               | Why                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request body       | **25 MB** through the proxy (Cloud Run's own HTTP/1 limit is 32 MB) | Resume PDFs (bulk upload) and profile pictures sent as base64 inside JSON. Please make sure FastAPI/uvicorn accept this, or tell us your real limit so we can check it before upload.                                                                                |
| HTTP response time | **under 300 s**                                                     | nginx cuts normal requests at 300 s, and the user sees "The server took too long to respond". `verify-otp` interview generation takes about 1 minute, which is fine. Anything that can take minutes should become async plus polling, as Resume analysis already is. |

---

## 8. 🟡 Health endpoint

`GET /api/health` works on the new backend. Please:

- **use it as the Cloud Run startup and liveness probe;**
- **keep it cheap:** no heavy database work;
- **exempt it from app-level rate limiting.**

It's also how we'll check the backend is healthy after each deploy.

---

## 9. 🟢 Nice to have: audit log entry `id`

Audit log entries (`/api/admin/audit-logs` and the platform equivalent) have no ID. The frontend builds a key from `createdAt + actorEmail + action`, which can collide when the same person does the same thing twice in the same instant. A stable `id` per entry would fix this.

---

## CORS

**Nothing is needed for production.** Calls are same-origin through the frontend's nginx, so the browser makes no cross-origin request. If CORS stays enabled, keep `localhost` and ngrok origins **out** of the production allow-list.

**Local development is different.** A developer whose `.env` sets `VITE_API_BASE_URL` to the backend calls it cross-origin from `http://localhost:5173`. That only works if `localhost:5173` is in the allow-list, and the `ngrok-skip-browser-warning` and `Authorization` request headers are allowed. Keep these in a development-only list.

---

## How we'll verify, once #1–#4 are done

1. **Health:**
   ```bash
   for i in 1 2 3 4 5; do curl -s -o /dev/null -w "%{http_code} " https://recruiterai-backend-100366934313.northamerica-northeast1.run.app/api/health; done
   ```
   This should print `200` five times. It does today.
2. **Live view:** start an interview on a phone and open its live page on a laptop. The picture should appear within about 3 seconds.
3. **Live view under load:** repeat with the service scaled to two or more instances (for example `--min-instances=2`). The picture must still appear.
4. **Socket lifetime:** keep a sitting running for more than 10 minutes, and confirm the sockets aren't dropped at 5.
5. **Invitations:** the link in the invitation email opens the production domain.

---

## FYI: frontend changes in this release (no backend action needed)

- **New backend.** The frontend's production proxy now points at the northamerica-northeast1 backend.
- **Readable messages** for Cloud Run and nginx error pages (429/502/503/504), instead of a technical error.
- **No automatic retries on 4xx.** The frontend no longer retries 4xx responses, including 429, so it doesn't add load to a struggling backend. It retries once on a network failure or 5xx.
- **Smaller app download.** Pages now download on first visit, so a candidate downloads about 300 KB of code (compressed) instead of about 440 KB.
- **Clean recovery after a deploy.** A tab opened before a deploy reloads itself instead of breaking.

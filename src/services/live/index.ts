/**
 * Live interview viewing — the candidate's own recording bytes, relayed by the
 * backend over `WSS /api/live-relay/{interview_id}`.
 *
 *   import { useLiveRelay } from "@/services/live"   // HR / admin watching
 *
 * There is no candidate half any more, and that is the point. This used to be
 * peer-to-peer WebRTC: the candidate's tab published a stream, this one answered
 * an offer, and the two negotiated a route. With public STUN and no TURN relay
 * that negotiation silently never completed on a corporate network, a VPN or
 * symmetric NAT — which is why every recruiter on such a network saw "live view
 * unavailable" and nothing else. The relay replaces the whole handshake with one
 * socket per viewer, so the only thing live view now depends on is the recording
 * stream the candidate is already sending.
 *
 * `signaling.ts`, `use-live-publish.ts` and `use-live-viewer.ts` were deleted
 * with that path. `WS /api/live/{interview_id}` still answers on the backend, but
 * it is no longer the contract — don't build on it again.
 */

export * from "./live-relay"
export * from "./use-live-relay"

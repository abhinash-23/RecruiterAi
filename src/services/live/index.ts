/**
 * Live interview viewing — WebRTC over `WS /api/live/{interview_id}`.
 *
 *   import { useLiveViewer } from "@/services/live"   // HR / admin watching
 *   import { useLivePublish } from "@/services/live"  // the candidate's tab
 *
 * Both halves live here rather than beside the pages that use them: they
 * implement two ends of one handshake, and splitting them across features is
 * how a `peer` field ends up set on one side and omitted on the other.
 */

export * from "./signaling"
export * from "./use-live-publish"
export * from "./use-live-viewer"

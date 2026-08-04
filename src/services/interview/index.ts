/**
 * The candidate-facing interview engine. No login: a link plus a one-time code
 * mints a short-lived token bound to a single interview.
 *
 *   import { verifyOtp, submitAnswer } from "@/services/interview"
 *
 * The staff view of the same interviews (list, results, playback) lives in
 * `@/services/hr` instead.
 */

export * from "./session"

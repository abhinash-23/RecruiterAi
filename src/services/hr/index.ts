/**
 * HR's backend surface — the recruiting funnel (`/api/hr/*`) plus the staff
 * view of the interview engine. Admins reach the same endpoints with
 * company-wide visibility.
 *
 *   import { useJobs, useShortlist, type Job } from "@/services/hr"
 */

export * from "./jobs"
export * from "./interviews"
export * from "./use-hr"

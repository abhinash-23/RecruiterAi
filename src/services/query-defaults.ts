/**
 * How the console keeps what is on screen in step with the server.
 *
 * **Two triggers, both of them deliberate acts:** opening a page that needs the
 * data, and a write that invalidates it — every mutation invalidates the keys it
 * changed, including the dashboards and audit trails that summarise them (see
 * `derived-reads.ts`). While you sit on a page, nothing is requested.
 *
 * The omissions are the policy. No interval, because a timer re-asks a question
 * nobody is waiting on an answer to, and one client-wide interval means the
 * layout's notification bell polls from every page in the app. No focus refetch,
 * because returning to a tab is not news. And a read whose UI is closed — a
 * dialog's defaults, a panel behind an unopened tab — takes an `enabled` flag, so
 * it is fetched when it is opened rather than when it is mounted.
 *
 * What is left is `refetchOnMount: "always"`: one request per page visit, per
 * query that page actually needs. That much is not optional — without it,
 * navigating back to a list showed it as it stood before the row you had just
 * added, which is where all of this started.
 *
 * Only reads awaiting something no one in this browser will trigger get a timer,
 * and they set it themselves: the live pages (10s), live vitals (8s), and the
 * shortlist while a résumé is being scored (4s, stopping the moment none are
 * pending).
 */

/**
 * How long a read stays fresh.
 *
 * Nearly inert while `refetchOnMount: "always"` is the client-wide rule, which
 * ignores it by design. It governs the reads that opt back into
 * `refetchOnMount: true` — see {@link STATIC_READ} — and is the value to reach
 * for if a read should ever be exempted from re-reading on every visit.
 */
export const AUTO_REFETCH_MS = 15_000

/**
 * Reads that are effectively static for the length of a session — branding, a
 * logo. Even a refetch per page visit buys nothing here, and where a deployment
 * gates company branding behind Admin (§4.1 of the handover) each one is another
 * 403. Writes to them invalidate their key, so an edit still shows up at once.
 */
export const STATIC_READ = {
  staleTime: 10 * 60_000,
  // Back to honouring `staleTime` rather than the client-wide "always": a
  // remount inside ten minutes has nothing to learn.
  refetchOnMount: true,
  refetchOnWindowFocus: false,
} as const

/**
 * Reads where a *refetch itself* is the problem, not the traffic. The recording
 * playback URL is minted per request and time-limited, so re-reading it hands the
 * `<video>` a different src and restarts whatever the recruiter was watching.
 *
 * Overlaps the client-wide defaults today and is kept anyway: this is the one
 * place where re-reading is actively harmful rather than merely wasteful, and it
 * should not quietly become harmful again if those defaults are ever loosened.
 */
export const ONE_SHOT_READ = {
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const

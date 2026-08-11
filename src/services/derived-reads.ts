import type { QueryClient } from "@tanstack/react-query"

/**
 * Reads that summarise other people's writes: the dashboards, the platform
 * analytics and both audit trails.
 *
 * Matched on the second key segment rather than by listing whole keys, because
 * the same read exists per tier and per row limit — `["company", "dashboard"]`,
 * `["platform", "analytics"]`, `["company", "audit-logs", 50]`,
 * `["platform", "audit-logs", 100]` — and a hand-listed key silently stops
 * matching the day a page asks for a different limit.
 */
const DERIVED_SEGMENTS = ["dashboard", "analytics", "audit-logs"]

/**
 * Marks every summary read stale after a write.
 *
 * Creating a job moves a KPI tile and writes an audit line, but the mutation
 * that created it only knows about the jobs list — so the dashboard kept
 * showing the old count until someone reloaded. Call this from any write and
 * the aggregates follow their own detail.
 *
 * Cheap by construction: `invalidateQueries` only refetches queries that are
 * currently mounted, so on the jobs page this issues no request at all.
 */
export function refreshDerivedReads(client: QueryClient) {
  void client.invalidateQueries({
    predicate: (query) =>
      DERIVED_SEGMENTS.includes(String(query.queryKey[1])),
  })
}

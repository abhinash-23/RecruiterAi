/**
 * The hint in an empty Interview duration box: it can be customised, and what
 * applies when it isn't. Left empty, the company default is used.
 */
export function durationPlaceholder(defaultMinutes: number | undefined): string {
  return defaultMinutes
    ? `Custom · ${defaultMinutes} min (company default)`
    : "Customise your interview duration"
}

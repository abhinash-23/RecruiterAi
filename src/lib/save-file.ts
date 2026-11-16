/**
 * Hands a blob to the browser as a download, under `filename`.
 *
 * The object URL is released on the next tick rather than at once: Safari
 * starts the download asynchronously and cancels it if the URL is revoked
 * inside the same task as the click.
 */
export function saveFile(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = href
  link.download = filename
  link.rel = "noopener"
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(href), 0)
}

/** The reader's offset from UTC in minutes, as the report endpoints want it (IST = 330). */
export function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset()
}

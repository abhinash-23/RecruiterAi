import { toast } from "sonner"

import { getResumeFileUrl } from "@/services/hr"
import { ApiError } from "@/services/http-client"

/**
 * Opens a candidate's original Resume file in a new tab, through a link that
 * lasts 15 minutes — so it is fetched per click, never kept.
 *
 * The tab is opened before the link is fetched, inside the click, so a popup
 * blocker lets it through. Only files that came in through bulk upload are
 * stored; for anyone else the server answers 404, and that is said plainly
 * rather than leaving a blank tab.
 */
export async function openResumeFile(candidateId: string): Promise<void> {
  const tab = window.open("", "_blank")
  try {
    const url = await getResumeFileUrl(candidateId)
    if (tab) {
      tab.opener = null
      tab.location.href = url
    } else {
      window.location.assign(url)
    }
  } catch (error) {
    tab?.close()
    toast.error(
      error instanceof ApiError && error.status === 404
        ? "The original file isn't stored for this candidate. Only bulk uploads keep it."
        : error instanceof Error
          ? error.message
          : "Couldn't open the Resume."
    )
  }
}

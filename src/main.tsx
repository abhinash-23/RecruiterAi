import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { normaliseHashRoute } from "./lib/normalise-hash-route"
import { installGlobalErrorReporting } from "./lib/report-error"
import { installFrameLogExport } from "./services/frame-log"

// First, so an error thrown while the app boots is reported too.
installGlobalErrorReporting()
installFrameLogExport()
reloadOnStaleBuild()

// Interview invitation emails carry hash-form links (`/#/otp?…`). Translate
// them before the router mounts, so the first route match is already right.
normaliseHashRoute()

/**
 * Pages are downloaded on first visit, and a deploy replaces every file name.
 * A tab opened before the deploy still runs the old build, so the next page it
 * opens asks for a file that no longer exists. Reloading picks up the new build
 * and the page the user was going to.
 *
 * Once per half minute at most: if the new build is broken too, a reload loop
 * would hide that, and the page's own "Reload page" message is the better end.
 */
function reloadOnStaleBuild() {
  const KEY = "ra:stale-build-reload"
  window.addEventListener("vite:preloadError", (event) => {
    try {
      const last = Number(sessionStorage.getItem(KEY) ?? 0)
      if (Date.now() - last < 30_000) return
      sessionStorage.setItem(KEY, String(Date.now()))
    } catch {
      return // Storage blocked: no loop guard, so no automatic reload.
    }
    event.preventDefault()
    window.location.reload()
  })
}

// Providers (theme, query client, auth, router) live in `app/providers.tsx`.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

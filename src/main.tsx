import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { normaliseHashRoute } from "./lib/normalise-hash-route"

// Interview invitation emails carry hash-form links (`/#/otp?…`). Translate
// them before the router mounts, so the first route match is already right.
normaliseHashRoute()

// Providers (theme, query client, auth, router) live in `app/providers.tsx`.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

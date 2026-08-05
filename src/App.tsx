import { AppRoutes } from "@/app/router"
import { Providers } from "@/app/providers"
import { Watermark } from "@/components/shared/watermark"

export function App() {
  return (
    <Providers>
      <AppRoutes />
      {/* Outside the routes on purpose: every screen gets it, including the ones
          with no layout of their own — landing, login, and the candidate's
          interview. */}
      <Watermark />
    </Providers>
  )
}

export default App

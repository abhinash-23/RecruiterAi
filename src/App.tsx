import { AppRoutes } from "@/app/router"
import { Providers } from "@/app/providers"
import { AppErrorBoundary } from "@/components/shared/error-boundary"
import { Watermark } from "@/components/shared/watermark"

export function App() {
  return (
    <Providers>
      <AppErrorBoundary>
        <AppRoutes />
      </AppErrorBoundary>
      {/* Outside the routes on purpose: every screen gets it, including the ones
          with no layout of their own — landing, login, and the candidate's
          interview. */}
      <Watermark />
    </Providers>
  )
}

export default App

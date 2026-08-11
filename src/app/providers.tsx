import * as React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter } from "react-router-dom"

import { Toaster } from "@/components/ui/sonner"
import { ThemeProvider } from "@/components/theme-provider"
import { AuthProvider } from "@/features/auth/auth-context"
import { AUTO_REFETCH_MS } from "@/services/query-defaults"

/**
 * One QueryClient for the app's lifetime.
 *
 * The refresh policy is deliberately client-wide rather than per hook: see
 * `services/query-defaults.ts` for why every read keeps itself current, and for
 * the two presets that opt out of it.
 */
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        /* **Two triggers, and no third.** A read happens when a page that needs
         * it is opened, and when a write invalidates it. Nothing else.
         *
         * No `refetchInterval`: a client-wide one polls whatever happens to be
         * mounted, and the notification bell in the dashboard layout is mounted
         * on *every* page — so it re-read the audit log every few seconds
         * forever, on top of whatever the page itself was reading. The handful
         * of reads genuinely awaiting an outside event set their own interval:
         * the live pages, live vitals, and the shortlist while a résumé is being
         * scored.
         *
         * No `refetchOnWindowFocus` either, though it is the library's default
         * and sounds harmless. A focus event is a mouse click, not news: with
         * DevTools docked beside the app, every click from the panel back into
         * the page re-requested everything on screen, which is most of what a
         * long network log fills up with. Coming back to a tab does not mean the
         * data changed, and if it did, opening any page re-reads it.
         *
         * `refetchOnMount: "always"` is the one that stays: `true` defers to
         * `staleTime`, and being shown a list as it stood *before* the thing you
          * just added was the original complaint. So navigating to a page costs
         * exactly one request per query it needs — no more, and never while you
         * sit there. `staleTime` therefore governs almost nothing here; it still
         * applies to the reads that opt back into `refetchOnMount: true`
         * (see STATIC_READ).
         */
        staleTime: AUTO_REFETCH_MS,
        refetchOnMount: "always",
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: 1,
      },
    },
  })
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(createQueryClient)

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>{children}</BrowserRouter>
          <Toaster position="bottom-right" />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

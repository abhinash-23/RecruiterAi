import * as React from "react"
import { useLocation } from "react-router-dom"
import { AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { reportError } from "@/lib/report-error"

interface ErrorBoundaryProps {
  children: React.ReactNode
  /** What to render instead of the crashed subtree. `reset` re-renders it. */
  fallback: (props: { error: unknown; reset: () => void }) => React.ReactNode
  resetKey?: string
  /** Names the boundary in the error report. */
  name?: string
}

interface ErrorBoundaryState {
  error: unknown
  hasError: boolean
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, hasError: false }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error, hasError: true }
  }

  componentDidCatch(error: unknown, info: React.ErrorInfo) {
    reportError(
      error,
      `boundary:${this.props.name ?? "unnamed"}`,
      info.componentStack ?? undefined
    )
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.reset()
    }
  }

  reset = () => {
    this.setState({ error: null, hasError: false })
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback({ error: this.state.error, reset: this.reset })
    }
    return this.props.children
  }
}

/**
 * The last line: wraps every route, so a crash anywhere still leaves the user a
 * way out. Full screen, because whatever crashed may have been the layout.
 */
export function AppErrorBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()

  return (
    <ErrorBoundary
      name="app"
      resetKey={pathname}
      fallback={({ error, reset }) => (
        <div className="flex min-h-svh items-center justify-center bg-background p-6">
          <CrashMessage error={error} reset={reset} />
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  )
}

/**
 * Wraps one dashboard page inside the layout, so the sidebar and header survive
 * a crash in the page and the user can simply go somewhere else.
 */
export function PageErrorBoundary({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation()

  return (
    <ErrorBoundary
      name="page"
      resetKey={pathname}
      fallback={({ error, reset }) => (
        <div className="flex justify-center py-16">
          <CrashMessage error={error} reset={reset} />
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  )
}

function CrashMessage({ error, reset }: { error: unknown; reset: () => void }) {
  return (
    <div
      role="alert"
      className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center text-card-foreground"
    >
      <AlertTriangle className="size-8 text-destructive" aria-hidden />
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Something went wrong</h2>
        <p className="text-sm text-muted-foreground">
          This page hit an unexpected error. Try again, or reload if it keeps
          happening.
        </p>
      </div>

      {/* The message helps whoever is fixing it and means nothing to anyone
          else, so it stays out of production. */}
      {import.meta.env.DEV && error instanceof Error ? (
        <pre className="max-h-32 w-full overflow-auto rounded-md bg-muted p-3 text-left text-xs whitespace-pre-wrap">
          {error.message}
        </pre>
      ) : null}

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload page
        </Button>
        <Button onClick={reset}>
          <RotateCcw />
          Try again
        </Button>
      </div>
    </div>
  )
}

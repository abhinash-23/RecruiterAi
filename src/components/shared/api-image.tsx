import * as React from "react"

import { fetchApiAsset } from "@/services/http-client"
import { cn } from "@/lib/utils"

export interface ApiImageProps {
  /** Path the API reported, e.g. `/api/branding/logo?company=acme&v=17857…`. */
  src: string
  alt: string
  className?: string
  /** Rendered in place of a file that couldn't be read. */
  fallback?: React.ReactNode
  /**
   * Rendered while the bytes are in flight. Defaults to `fallback`, which is
   * usually what you want — pass something neutral when the fallback is a
   * *different* piece of branding, so it doesn't flash on screen for the
   * length of one request before the real thing arrives.
   */
  pending?: React.ReactNode
}

/**
 * An image the API serves, loaded through `fetch` rather than the `src`
 * attribute.
 *
 * The browser sends no custom headers for an `<img>`, and the ngrok tunnel this
 * backend sits behind answers such requests with an HTML interstitial — so the
 * plain markup shows a broken image. Fetching the bytes ourselves also means a
 * failure is a state we can render, instead of a browser-drawn placeholder.
 */
export function ApiImage({
  src,
  alt,
  className,
  fallback,
  pending,
}: ApiImageProps) {
  // Both states carry the `src` they belong to, so a new one renders as
  // loading without the effect having to reset anything on its way in — which
  // would be a synchronous setState, and a second render for every image.
  const [loaded, setLoaded] = React.useState<{ src: string; url: string } | null>(
    null
  )
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null)

  React.useEffect(() => {
    const controller = new AbortController()
    let created: string | null = null

    void fetchApiAsset(src, controller.signal)
      .then((blob) => {
        created = URL.createObjectURL(blob)
        setLoaded({ src, url: created })
      })
      .catch(() => {
        // An abort is this effect being cleaned up, not a failure to report.
        if (!controller.signal.aborted) setFailedSrc(src)
      })

    return () => {
      controller.abort()
      // Object URLs live until revoked; one per changed `src` leaks the file.
      if (created) URL.revokeObjectURL(created)
    }
  }, [src])

  if (failedSrc === src) return <>{fallback ?? null}</>

  const url = loaded?.src === src ? loaded.url : null
  if (!url) return <>{pending ?? fallback ?? null}</>

  return <img src={url} alt={alt} className={cn(className)} />
}

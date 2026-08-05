import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { ApiImage } from "@/components/shared/api-image"
import { cn } from "@/lib/utils"

/** First letters of the first two words, which is what a monogram is. */
function initials(name: string) {
  return (
    name
      .split(/[\s@.]+/)
      .filter(Boolean)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  )
}

/**
 * A user's own picture, falling back to their monogram.
 *
 * Not `<AvatarImage>`: the picture URL is bearer-authenticated, so the browser's
 * own image loading gets a 401 — every API asset in this app goes through
 * `ApiImage`, which fetches the bytes with the token attached.
 *
 * The monogram is the `pending` state as well as the `fallback`, because unlike
 * a company logo it isn't a *different* piece of branding that would be wrong to
 * flash on screen — it's the same person either way.
 */
export function UserAvatar({
  name,
  pictureUrl,
  className,
  textClassName,
}: {
  name: string
  pictureUrl?: string | null
  className?: string
  /** Sizes the monogram; the default suits the ~40px case. */
  textClassName?: string
}) {
  const monogram = (
    <AvatarFallback className={textClassName}>{initials(name)}</AvatarFallback>
  )

  return (
    <Avatar className={cn("shrink-0", className)}>
      {pictureUrl ? (
        <ApiImage
          src={pictureUrl}
          alt={`${name}'s profile picture`}
          // `rounded-full` here as well as on the root: the root is only rounded,
          // never clipped, so a square photo would sit in a circular frame with
          // its corners hanging out.
          className="size-full rounded-full object-cover"
          fallback={monogram}
          pending={monogram}
        />
      ) : (
        monogram
      )}
    </Avatar>
  )
}

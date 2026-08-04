/**
 * Small helpers with no React in them: motion preferences, the code tokenizer
 * behind the syntax highlighting, and the model call used by the playground.
 */
/* ==========================================================================
   motion.ts
   ========================================================================== */

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

export function isTouchDevice(): boolean {
  return window.matchMedia("(hover: none)").matches
}

/* ==========================================================================
   tokenize-code.ts
   ========================================================================== */

export type TokenKind = "comment" | "string" | "key" | "number" | "plain"

export interface CodeToken {
  kind: TokenKind
  text: string
}

const TOKEN_PATTERN = /(\/\/[^\n]*)|("(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)/g

/**
 * Tokenizes a cURL / JSON snippet for display. Mirrors the original page's
 * highlighter: comments, strings, numbers, and JSON keys (a string immediately
 * followed by a colon) each get their own colour.
 */
export function tokenizeCode(code: string): CodeToken[] {
  const tokens: CodeToken[] = []
  let lastIndex = 0

  TOKEN_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = TOKEN_PATTERN.exec(code)) !== null) {
    const [raw, comment, string, num] = match

    // A `//` inside a URL (`https://`) is not a comment.
    if (comment && code[match.index - 1] === ":") {
      continue
    }

    if (match.index > lastIndex) {
      tokens.push({ kind: "plain", text: code.slice(lastIndex, match.index) })
    }

    if (comment) {
      tokens.push({ kind: "comment", text: raw })
    } else if (string) {
      const isKey = /^\s*:/.test(code.slice(match.index + raw.length))
      tokens.push({ kind: isKey ? "key" : "string", text: raw })
    } else if (num) {
      tokens.push({ kind: "number", text: raw })
    }

    lastIndex = match.index + raw.length
  }

  if (lastIndex < code.length) {
    tokens.push({ kind: "plain", text: code.slice(lastIndex) })
  }

  return tokens
}

/* ==========================================================================
   call-model.ts
   ========================================================================== */

const MODEL_ENDPOINT = "https://api.anthropic.com/v1/messages"

/**
 * Calls the model that powers the live interview and API playground demos.
 * Returns `null` on any failure so callers can fall back to canned content —
 * the landing page is always usable without a working key.
 */
export async function callModel(
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal
): Promise<string | null> {
  try {
    const response = await fetch(MODEL_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
      signal,
    })

    if (!response.ok) {
      return null
    }

    const data = (await response.json()) as {
      content?: Array<{ text?: string }>
    }

    return data.content?.[0]?.text ?? null
  } catch {
    return null
  }
}

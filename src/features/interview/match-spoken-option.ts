/**
 * ============================================================================
 * TURNING A SPOKEN ANSWER INTO AN OPTION
 * ============================================================================
 * A multiple-choice answer is submitted as an **index**, so a candidate who
 * says "option A" out loud has to be mapped onto one before it can be sent.
 * Handing the raw sentence to the scorer instead marks a correct answer wrong.
 *
 * Everything here works on **tokens**, never raw substrings. "I disagree"
 * contains the substring "agree", so substring matching picks the opposite
 * answer — on a Likert scale, the worst possible failure.
 */

/** A/B/C/D/E… as the host reads them out. */
const LETTERS = "abcdefghij".split("")

/** What speech recognisers produce for a spoken letter. */
const LETTER_SOUNDS: Record<string, string> = {
  ay: "a",
  eh: "a",
  bee: "b",
  be: "b",
  b: "b",
  see: "c",
  sea: "c",
  cee: "c",
  dee: "d",
  de: "d",
  ee: "e",
  eee: "e",
  ef: "f",
  eff: "f",
  gee: "g",
  aitch: "h",
  haitch: "h",
  eye: "i",
  jay: "j",
}

/** Words that carry no meaning for matching, so they can't tip a comparison. */
const FILLER = new Set([
  "the",
  "a",
  "an",
  "is",
  "am",
  "i",
  "my",
  "me",
  "it",
  "its",
  "that",
  "this",
  "would",
  "will",
  "please",
  "answer",
  "option",
  "choice",
  "choose",
  "select",
  "pick",
  "letter",
  "go",
  "with",
  "for",
  "say",
  "saying",
  "think",
  "thing",
  "and",
  "of",
  "to",
  "um",
  "uh",
])

function tokenise(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

/** Is `needle` present in `haystack` as a run of whole words? */
function containsTokens(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false

  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false
        break
      }
    }
    if (matched) return true
  }
  return false
}

/**
 * Reads an explicit letter out of the utterance.
 *
 * Only where the speaker clearly meant a letter: after a cue word ("option a",
 * "letter b"), or as the entire answer. A bare "a" in the middle of a sentence
 * is the article, not a choice.
 */
function spokenLetter(tokens: string[], count: number): number | null {
  const asIndex = (token: string) => {
    const letter = token.length === 1 ? token : LETTER_SOUNDS[token]
    if (!letter) return null
    const index = LETTERS.indexOf(letter)
    return index >= 0 && index < count ? index : null
  }

  const CUES = new Set(["option", "answer", "choice", "letter", "select", "choose", "pick"])
  for (let position = 0; position < tokens.length - 1; position += 1) {
    if (!CUES.has(tokens[position])) continue
    const index = asIndex(tokens[position + 1])
    if (index !== null) return index
  }

  if (tokens.length === 1) return asIndex(tokens[0])
  return null
}

/**
 * Maps a spoken answer onto one of `options`, or null when nothing matches
 * confidently enough to answer on the candidate's behalf.
 *
 * Order matters: an explicit letter beats everything, then the option said in
 * full, then the closest by shared words. Ties go to the **most specific**
 * option, which is what keeps "strongly agree" off "Agree".
 */
export function matchSpokenOption(
  spoken: string,
  options: string[]
): number | null {
  const tokens = tokenise(spoken)
  if (tokens.length === 0 || options.length === 0) return null

  const byLetter = spokenLetter(tokens, options.length)
  if (byLetter !== null) return byLetter

  const meaningful = tokens.filter((token) => !FILLER.has(token))
  const haystack = meaningful.length > 0 ? meaningful : tokens

  let best: { index: number; score: number } | null = null

  options.forEach((option, index) => {
    const optionTokens = tokenise(option).filter((token) => !FILLER.has(token))
    if (optionTokens.length === 0) return

    // Said in full — scored by length so the longer option wins a tie, which
    // is how "strongly agree" beats "agree".
    if (containsTokens(haystack, optionTokens)) {
      const score = 100 + optionTokens.length
      if (!best || score > best.score) best = { index, score }
      return
    }

    // Otherwise: how much of this option did they actually say?
    const hits = optionTokens.filter((token) => haystack.includes(token)).length
    if (hits === 0) return

    const score = (hits / optionTokens.length) * 10 + hits
    if (!best || score > best.score) best = { index, score }
  })

  // Below this, the "match" is one incidental word in common — better to ask
  // again than to answer a psychometric question wrongly on their behalf.
  const MINIMUM = 6
  const winner = best as { index: number; score: number } | null
  return winner && winner.score >= MINIMUM ? winner.index : null
}

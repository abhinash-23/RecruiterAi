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
  hey: "a",
  bee: "b",
  be: "b",
  b: "b",
  see: "c",
  sea: "c",
  cee: "c",
  si: "c",
  dee: "d",
  de: "d",
  ee: "e",
  eee: "e",
  ef: "f",
  eff: "f",
  gee: "g",
  jee: "g",
  aitch: "h",
  haitch: "h",
  eye: "i",
  aye: "i",
  jay: "j",
}

/** "Option one" and "option 1" are the same request. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

/**
 * After these, a letter or number is unambiguously a choice — including "a",
 * which everywhere else in a sentence is just the article.
 */
const STRONG_CUES = new Set([
  "option",
  "options",
  "letter",
  "choice",
  "choices",
  "answer",
  "number",
  "select",
  "selected",
  "choose",
  "chose",
  "chosen",
  "pick",
  "picked",
  "mark",
])

/**
 * Weaker lead-ins: "it is C", "I'll go with D". A letter still counts after
 * one, but "a" and "i" don't — "it is a good idea" would otherwise answer A on
 * the candidate's behalf.
 */
const WEAK_CUES = new Set(["is", "its", "go", "with", "say", "said", "was"])

/**
 * Skipped between a strong cue and the letter, so "the answer is B" and "I'll
 * go with option C" both land. A letter is always tried before a word is
 * treated as a bridge, which keeps "answer a" reading as the choice A.
 */
const BRIDGE = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "be",
  "my",
  "i",
  "ill",
  "ll",
  "will",
  "would",
  "to",
  "for",
  "with",
  "going",
  "gonna",
  "go",
  "say",
  "saying",
  "think",
  "it",
  "its",
  "that",
  "of",
  "um",
  "uh",
  "so",
  "then",
  "option",
  "options",
  "letter",
  "choice",
  "number",
  "answer",
  "select",
  "choose",
  "pick",
])

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
 * Reads a single token as a choice index — "b", "bee", "3", "three" — or null.
 * `count` bounds it, so "option 9" on a five-option question is not a choice.
 */
function asIndex(token: string, count: number): number | null {
  const number = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token]
  if (number !== undefined) {
    return number >= 1 && number <= count ? number - 1 : null
  }

  const letter = token.length === 1 ? token : LETTER_SOUNDS[token]
  if (!letter) return null
  const index = LETTERS.indexOf(letter)
  return index >= 0 && index < count ? index : null
}

/**
 * Reads an explicit choice out of the utterance.
 *
 * Only where the speaker clearly meant one: after a cue word ("option a",
 * "the answer is b", "number 3"), or as the entire answer. A bare "a" in the
 * middle of a sentence is the article, not a choice.
 *
 * The **last** cue wins. A candidate who corrects themselves — "C, sorry,
 * option D" — means the second one, and it also shrugs off anything the mic
 * picked up before they got to the answer.
 */
function spokenLetter(tokens: string[], count: number): number | null {
  let found: number | null = null

  for (let position = 0; position < tokens.length - 1; position += 1) {
    const token = tokens[position]

    if (STRONG_CUES.has(token)) {
      // Walk forward over connective words until a choice turns up, or
      // something that is neither a choice nor a bridge ends the search.
      for (let ahead = position + 1; ahead < tokens.length; ahead += 1) {
        const index = asIndex(tokens[ahead], count)
        if (index !== null) {
          found = index
          break
        }
        if (!BRIDGE.has(tokens[ahead])) break
      }
      continue
    }

    if (WEAK_CUES.has(token)) {
      // Strictly the next word, and never the article-shaped letters.
      const next = tokens[position + 1]
      if (next === "a" || next === "i") continue
      const index = asIndex(next, count)
      if (index !== null) found = index
    }
  }

  if (found !== null) return found
  if (tokens.length === 1) return asIndex(tokens[0], count)
  return null
}

/**
 * A letter left hanging on the end — "umm, B", "I'd say… C".
 *
 * Single characters only: "be" sounds like B, but "that would be" ends far too
 * many real sentences to read as a choice. "a" and "i" are excluded for the
 * same reason. Used only once matching on the option's own words has failed.
 */
function trailingLetter(tokens: string[], count: number): number | null {
  const last = tokens[tokens.length - 1]
  if (!last || last.length !== 1 || last === "a" || last === "i") return null
  return asIndex(last, count)
}

/**
 * How sure we are, which decides whether it's safe to act *while the candidate
 * is still speaking*:
 *
 *  - `letter`  — they named it ("option B"). Unambiguous, and it can never be
 *    the prefix of some other option, so it can be acted on immediately.
 *  - `phrase`  — they said the option's own words, all of them. Safe once the
 *    recogniser has settled, but not before: "strongly" is a prefix of both
 *    "Strongly Agree" and "Strongly Disagree".
 *  - `partial` — some words in common. Only ever good enough when the candidate
 *    has finished and stopped the mic themselves.
 */
export type MatchVia = "letter" | "phrase" | "partial"

export interface SpokenChoice {
  index: number
  via: MatchVia
}

/**
 * Maps a spoken answer onto one of `options`, with how confident the match is,
 * or null when nothing matches well enough to answer on the candidate's behalf.
 *
 * Order matters: an explicit letter beats everything, then the option said in
 * full, then a letter trailing the sentence, then the closest by shared words.
 * Ties go to the **most specific** option, which is what keeps "strongly
 * agree" off "Agree".
 */
export function matchSpokenChoice(
  spoken: string,
  options: string[]
): SpokenChoice | null {
  const tokens = tokenise(spoken)
  if (tokens.length === 0 || options.length === 0) return null

  const byLetter = spokenLetter(tokens, options.length)
  if (byLetter !== null) return { index: byLetter, via: "letter" }

  const meaningful = tokens.filter((token) => !FILLER.has(token))
  const haystack = meaningful.length > 0 ? meaningful : tokens

  /** Above this a score means "they said the option itself". */
  const SAID_IN_FULL = 100
  let best: { index: number; score: number } | null = null

  options.forEach((option, index) => {
    const optionTokens = tokenise(option).filter((token) => !FILLER.has(token))
    if (optionTokens.length === 0) return

    // Said in full — scored by length so the longer option wins a tie, which
    // is how "strongly agree" beats "agree".
    if (containsTokens(haystack, optionTokens)) {
      const score = SAID_IN_FULL + optionTokens.length
      if (!best || score > best.score) best = { index, score }
      return
    }

    // Otherwise: how much of this option did they actually say?
    const hits = optionTokens.filter((token) => haystack.includes(token)).length
    if (hits === 0) return

    const score = (hits / optionTokens.length) * 10 + hits
    if (!best || score > best.score) best = { index, score }
  })

  const winner = best as { index: number; score: number } | null
  if (winner && winner.score >= SAID_IN_FULL) {
    return { index: winner.index, via: "phrase" }
  }

  const byTrailing = trailingLetter(tokens, options.length)
  if (byTrailing !== null) return { index: byTrailing, via: "letter" }

  // Below this, the "match" is one incidental word in common — better to ask
  // again than to answer a psychometric question wrongly on their behalf.
  const MINIMUM = 6
  if (winner && winner.score >= MINIMUM) {
    return { index: winner.index, via: "partial" }
  }
  return null
}

/**
 * ============================================================================
 * "SEND ANSWER", SAID OUT LOUD
 * ============================================================================
 * With the microphone open for the whole sitting, an open question needs a way
 * to say *that's my answer* — otherwise the candidate has to reach for the mouse
 * between every question, which is the thing keeping the mic open was meant to
 * avoid.
 *
 * Only ever matched at the **end** of the utterance, and only as a phrase.
 * A lone "submit" or "done" appears far too easily inside a real answer ("…and
 * then I submit the form", "…once I was done with the migration") to be a
 * command, and swallowing a candidate's answer mid-sentence is unforgivable.
 */
const SEND_COMMANDS = [
  "send answer",
  "send my answer",
  "send it",
  "send this",
  "submit answer",
  "submit my answer",
  "submit it",
  "submit this",
  "next question",
  "thats my answer",
  "that is my answer",
  "end of answer",
  "finish answer",
  "im done",
  "i am done",
]

/**
 * Splits a dictated answer from a trailing "send answer" command.
 *
 * `body` is the answer with the command removed, `send` says whether one was
 * there. Callers append `body` either way, so the words are never lost.
 */
export function stripSendCommand(spoken: string): {
  body: string
  send: boolean
} {
  const words = spoken.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { body: "", send: false }

  // Compared word-for-word rather than through `tokenise`, which splits "don't"
  // into two tokens — that misaligns the count and would cut a word off the
  // candidate's answer along with the command.
  const plain = words.map((word) => word.toLowerCase().replace(/[^a-z0-9]/g, ""))

  for (const command of SEND_COMMANDS) {
    const needle = command.split(" ")
    if (needle.length > plain.length) continue

    const start = plain.length - needle.length
    if (needle.every((word, offset) => plain[start + offset] === word)) {
      // Sliced from the original words, so the answer keeps its punctuation.
      return { body: words.slice(0, start).join(" "), send: true }
    }
  }

  return { body: spoken.trim(), send: false }
}

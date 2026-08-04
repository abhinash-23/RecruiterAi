/**
 * ============================================================================
 * READING A RÉSUMÉ OUT OF A FILE
 * ============================================================================
 * `POST /api/analyze-resume` takes `resume_text` and nothing else — the only
 * endpoint that parses documents server-side is the job-scoped candidate
 * upload, which *creates candidates*. The standalone analyzer saves nothing, so
 * the text has to come out of the file here, in the browser.
 *
 * PDF.js is loaded with a dynamic `import()`: it and its worker are around a
 * megabyte, and most visits to the analyzer paste text instead of uploading.
 */

/** What the file input accepts. Both a suffix and a MIME type, since Safari
 *  reports some PDFs with an empty `type`. */
export const RESUME_FILE_ACCEPT = ".pdf,.txt,application/pdf,text/plain"

/** Matches the ceiling the candidate-upload endpoint enforces. */
export const RESUME_FILE_MAX_BYTES = 10 * 1024 * 1024

/** A problem worth showing the user verbatim, rather than "something failed". */
export class ResumeFileError extends Error {}

function isPdf(file: File) {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  )
}

function isPlainText(file: File) {
  return file.type.startsWith("text/") || /\.(txt|md)$/i.test(file.name)
}

/**
 * Collapses PDF.js's text items back into lines.
 *
 * A PDF has no concept of a line of text — it has positioned glyph runs, and
 * `hasEOL` is the only hint that one run ended a visual line. Joining
 * everything with spaces turns a two-column résumé into one unreadable
 * paragraph, which measurably changes the score the analyzer returns.
 */
function joinItems(items: readonly object[]): string {
  let out = ""
  for (const item of items) {
    // The array mixes text runs with marked-content markers, which carry no
    // text at all — hence the shape check rather than a cast.
    const { str, hasEOL } = item as { str?: unknown; hasEOL?: unknown }
    if (typeof str !== "string") continue

    out += str
    if (hasEOL === true) out += "\n"
    else if (!str.endsWith(" ")) out += " "
  }
  return out
}

async function readPdf(file: File): Promise<string> {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ])

  // Bundled by Vite and served from our own origin — pdf.js otherwise reaches
  // for a CDN build that a strict CSP (or an offline laptop) blocks.
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default

  const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
  let doc

  try {
    doc = await task.promise
  } catch (caught) {
    const name = (caught as { name?: string })?.name
    if (name === "PasswordException") {
      throw new ResumeFileError(
        "That PDF is password-protected. Remove the password, or paste the text instead."
      )
    }
    throw new ResumeFileError(
      "That PDF couldn't be opened. It may be damaged — try paste instead."
    )
  }

  try {
    const pages: string[] = []
    for (let number = 1; number <= doc.numPages; number += 1) {
      const page = await doc.getPage(number)
      const content = await page.getTextContent()
      pages.push(joinItems(content.items))
    }
    return pages.join("\n\n")
  } finally {
    // Destroying the *task* also tears down the document and its worker port;
    // leaking one per upload keeps the whole PDF in memory for the session.
    void task.destroy()
  }
}

/**
 * Extracts the résumé text from a picked file.
 *
 * Throws {@link ResumeFileError} with a sentence that can go straight on screen
 * — every failure here has a next step the user can take (remove the password,
 * export a text PDF, paste it instead), so none of them should surface as a
 * generic error.
 */
export async function readResumeFile(file: File): Promise<string> {
  if (file.size > RESUME_FILE_MAX_BYTES) {
    throw new ResumeFileError(
      `${file.name} is larger than ${RESUME_FILE_MAX_BYTES / 1024 / 1024} MB.`
    )
  }

  if (!isPdf(file) && !isPlainText(file)) {
    throw new ResumeFileError(
      "Only PDF and plain-text files can be read here. For a Word résumé, save it as PDF or paste the text."
    )
  }

  const text = (isPdf(file) ? await readPdf(file) : await file.text())
    // Normalise the whitespace PDF extraction leaves behind: trailing spaces on
    // every line, and runs of blank lines where the layout had columns.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()

  if (!text) {
    throw new ResumeFileError(
      "No text could be read from that file. Scanned or image-only PDFs need to be pasted in as text."
    )
  }

  return text
}

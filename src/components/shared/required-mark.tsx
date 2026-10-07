/**
 * The star after a required field's label.
 *
 * One component so it is one colour everywhere: it used to be red in the shared
 * form fields, plain text typed into some labels, and brand pink on the landing
 * page — three answers to the same question on the same product.
 */
export function RequiredMark() {
  return <span className="text-destructive">*</span>
}

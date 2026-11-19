/**
 * The one term the backend watches.
 *
 * The backend looks classes up in a single, hard-coded term (`'term'` in its
 * `app/loop.py`), and its API has no way to say which term a CRN belongs to.
 * So the page only offers alerts for sections of this term.
 *
 * CHANGE THIS EVERY TERM, together with the backend. The steps are in the
 * README under "Each term".
 */
export const SUPPORTED_TERM = {
  /** The university's code for the term: the `srcdb` value on the class search. */
  code: "202702",
  /** What to call it in a sentence. */
  label: "Winter 2027"
} as const

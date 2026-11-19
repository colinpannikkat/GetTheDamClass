/**
 * The few things the framed sign-in page tells the class page around it,
 * through `window.postMessage`. Nothing the user types is ever among them.
 */
import { Schema } from "effect"

export const FrameMessage = Schema.Union([
  /** Escape was pressed in the form: close the popover. */
  Schema.Struct({ type: Schema.Literal("getthedamclass/close") }),
  /** This form was used to sign in, and the email and PIN are saved: carry on. */
  Schema.Struct({ type: Schema.Literal("getthedamclass/signed-in") }),
  /** The form is this many pixels tall now: make the frame fit. */
  Schema.Struct({ type: Schema.Literal("getthedamclass/resize"), height: Schema.Number })
])
export type FrameMessage = typeof FrameMessage.Type

/**
 * The only site that may show the frame (see `web_accessible_resources` in
 * `wxt.config.ts`), and so the only one the frame sends messages to.
 */
export const CLASS_SEARCH_ORIGIN = "https://classes.oregonstate.edu"

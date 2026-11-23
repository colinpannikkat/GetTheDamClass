import { Schema } from "effect"

export const FrameMessage = Schema.Union([
  Schema.Struct({ type: Schema.Literal("getthedamclass/close") }),
  Schema.Struct({ type: Schema.Literal("getthedamclass/signed-in") }),
  Schema.Struct({ type: Schema.Literal("getthedamclass/resize"), height: Schema.Number })
])
export type FrameMessage = typeof FrameMessage.Type

export const CLASS_SEARCH_ORIGIN = "https://classes.oregonstate.edu"

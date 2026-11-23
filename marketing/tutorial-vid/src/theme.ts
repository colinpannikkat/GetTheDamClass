import { loadFont as loadDisplay } from "@remotion/google-fonts/BricolageGrotesque"
import { loadFont as loadMono } from "@remotion/google-fonts/GeistMono"
import { loadFont as loadText } from "@remotion/google-fonts/Geist"
import { Easing, interpolate } from "remotion"

export const FPS = 60
export const DURATION_S = 44.14

const display = loadDisplay("normal", { weights: ["700", "800"], subsets: ["latin"] })
const text = loadText("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] })
const mono = loadMono("normal", { weights: ["500", "600"], subsets: ["latin"] })

export const font = {
  display: display.fontFamily,
  text: text.fontFamily,
  mono: mono.fontFamily
}

export const color = {
  bg: "#0A0A0B",
  ink: "#F6F3EE",
  inkDim: "rgba(246,243,238,0.30)",
  inkMuted: "rgba(246,243,238,0.56)",
  line: "rgba(246,243,238,0.14)",
  /** Oregon State "Beaver Orange", the extension's one accent. */
  accent: "#D73F09",
  /** The same orange, lifted so it reads as text on the dark canvas. */
  accentText: "#FF6A2B",
  navy: "#061F2E"
}

/** The Chrome window in the takes, in points. The recordings are twice this in pixels. */
export const FOOTAGE = { w: 1536, h: 864 }

/** Seconds to frames. */
export const f = (seconds: number) => Math.round(seconds * FPS)

export const ease = {
  out: Easing.bezier(0.16, 1, 0.3, 1),
  inOut: Easing.bezier(0.65, 0, 0.35, 1),
  in: Easing.bezier(0.7, 0, 0.84, 0),
  soft: Easing.bezier(0.33, 1, 0.68, 1)
}

/** 0 to 1 between two times (seconds), clamped, with an easing. */
export const prog = (frame: number, from: number, to: number, easing: (n: number) => number = ease.out) =>
  interpolate(frame, [from * FPS, to * FPS], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing
  })

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

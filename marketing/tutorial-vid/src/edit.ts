// `out`, `t` and `from` are seconds in the finished video; `src` times are seconds in the take.
// Positions are footage points (1536 x 864, the Chrome window at 1x).

export const T = {
  introEnd: 6.35,
  windowIn: 6.3,
  emailIn: 32.15,
  emailOut: 35.5,
  outroIn: 35.62,
  lockupIn: 37.2,
  end: 44.14
}

// Recorded without the system pointer: the video draws its own.
const OPEN = "pickup_open.mp4"
const TAKE = "take.mp4"

// Video time [out, outEnd) shows take time [src, srcEnd). Without `srcEnd`, one frame is held.
export interface Segment {
  readonly file: string
  readonly out: number
  readonly outEnd: number
  readonly src: number
  readonly srcEnd?: number
}

const play = (file: string, out: number, outEnd: number, src: number, srcEnd: number): Segment => ({ file, out, outEnd, src, srcEnd })
const hold = (file: string, out: number, outEnd: number, src: number): Segment => ({ file, out, outEnd, src })

export const SEGMENTS: ReadonlyArray<Segment> = [
  // "First, head to the classes website."
  hold(OPEN, 6.0, 7.0, 1.8),
  play(OPEN, 7.0, 8.02, 2.28, 4.5),
  play(OPEN, 8.02, 8.62, 4.5, 5.86),

  // "Search for the class and term you need"
  hold(TAKE, 8.62, 9.22, 7.05),
  play(TAKE, 9.22, 9.85, 7.15, 7.8),
  hold(TAKE, 9.85, 10.02, 7.9),
  play(TAKE, 10.02, 10.17, 9.56, 9.71),
  hold(TAKE, 10.17, 10.45, 10.5),
  play(TAKE, 10.45, 10.67, 11.2, 11.42),
  play(TAKE, 10.67, 10.92, 11.42, 11.82),
  hold(TAKE, 10.92, 11.02, 12.5),

  // "and open the course details."
  play(TAKE, 11.02, 11.38, 13.12, 13.66),
  hold(TAKE, 11.38, 11.52, 14.9),
  play(TAKE, 11.52, 12.02, 15.36, 15.95),
  hold(TAKE, 12.02, 12.22, 17.5),
  play(TAKE, 12.22, 12.8, 18.05, 18.66),
  hold(TAKE, 12.8, 13.9, 19.5),

  // "Second, scroll down to All Sections and pick your exact section."
  play(TAKE, 13.9, 15.3, 20.5, 22.74),
  hold(TAKE, 15.3, 16.32, 24.5),
  play(TAKE, 16.32, 16.62, 24.83, 25.13),
  hold(TAKE, 16.62, 20.86, 26.5),

  // "Third, confirm the section at the top and click Notify me."
  play(TAKE, 20.86, 21.3, 27.53, 27.97),
  hold(TAKE, 21.3, 21.62, 28.6),

  // "Enter your email and type in your verification code."
  play(TAKE, 21.62, 22.62, 29.45, 31.34),
  hold(TAKE, 22.62, 22.92, 32.0),
  play(TAKE, 22.92, 23.22, 32.97, 33.27),
  hold(TAKE, 23.22, 23.47, 34.2),
  play(TAKE, 23.47, 24.35, 34.7, 35.66),
  hold(TAKE, 24.35, 24.88, 36.5),

  // "Once the button switches to Watching, your alert is live."
  play(TAKE, 24.88, 25.66, 37.32, 38.1),
  hold(TAKE, 25.66, 29.5, 39.5),

  // "You can manage your tracked classes anytime in the extension pop-up,"
  play(TAKE, 29.5, 29.8, 41.02, 41.32),
  hold(TAKE, 29.8, 30.35, 42.0),
  play(TAKE, 30.35, 31.05, 42.72, 43.42),
  hold(TAKE, 31.05, 36.3, 45.5)
]

// Scrolling the search panel leaves an empty strip under the site, so the camera stays above 823.
export const pageBottom = (time: number) => {
  const p = Math.min(1, Math.max(0, (time - 11.02) / 0.36))
  return 864 - 41 * p
}

export interface CursorKey {
  readonly t: number
  readonly dur: number
  readonly x: number
  readonly y: number
  readonly click?: boolean
}

export const CURSOR: ReadonlyArray<CursorKey> = [
  { t: 6.45, dur: 0.01, x: 820, y: 470 },
  { t: 6.5, dur: 0.45, x: 300, y: 64, click: true },
  { t: 8.62, dur: 0.53, x: 150, y: 276, click: true },
  { t: 9.72, dur: 0.32, x: 300, y: 324, click: true },
  { t: 10.12, dur: 0.35, x: 72, y: 392 },
  { t: 10.59, dur: 0.01, x: 72, y: 392, click: true },
  { t: 11.0, dur: 0.55, x: 175, y: 478, click: true },
  { t: 11.72, dur: 0.53, x: 560, y: 190, click: true },
  { t: 13.0, dur: 0.7, x: 1060, y: 520 },
  { t: 15.55, dur: 0.8, x: 760, y: 429, click: true },
  { t: 17.9, dur: 0.6, x: 906, y: 216 },
  { t: 19.95, dur: 0.93, x: 779, y: 793, click: true },
  { t: 21.2, dur: 0.32, x: 860, y: 640, click: true },
  { t: 22.6, dur: 0.34, x: 872, y: 727, click: true },
  { t: 23.14, dur: 0.26, x: 860, y: 596, click: true },
  { t: 24.42, dur: 0.48, x: 872, y: 683, click: true },
  { t: 25.7, dur: 0.6, x: 960, y: 690 },
  { t: 28.75, dur: 0.8, x: 1422, y: 64, click: true },
  { t: 29.9, dur: 0.5, x: 1215, y: 219, click: true },
  { t: 30.75, dur: 0.5, x: 1004, y: 262 }
]

export interface Spot {
  readonly from: number
  readonly to: number
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  readonly r?: number
}

export const SPOTS: ReadonlyArray<Spot> = [
  { from: 15.75, to: 16.2, x: 707, y: 412, w: 686, h: 33, r: 4 },
  { from: 18.45, to: 19.85, x: 703, y: 177, w: 180, h: 24, r: 5 },
  { from: 26.05, to: 28.5, x: 710, y: 769, w: 135, h: 46, r: 5 },
  { from: 31.15, to: 32.1, x: 1051, y: 194, w: 344, h: 46, r: 8 }
]

export const CURSOR_HIDDEN: ReadonlyArray<readonly [number, number]> = []

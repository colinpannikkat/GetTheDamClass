import type { CSSProperties, ReactNode } from "react"
import { AbsoluteFill, Img, interpolateColors, staticFile, useCurrentFrame, useVideoConfig } from "remotion"
import { CHUNKS, STAGES, WORDS } from "./captions"
import { T } from "./edit"
import { color, ease, font, FPS, prog } from "./theme"

/** The small pieces both videos use: the backdrop, the icon, headline type, and the captions. */

/* ---------- Backdrop ---------- */

/** The dark canvas: one warm glow that drifts slowly, and a little grain against banding. */
export const Backdrop: React.FC = () => {
  const t = useCurrentFrame() / FPS
  const x = 50 + Math.sin(t * 0.21) * 6
  const y = 112 + Math.cos(t * 0.17) * 4
  return (
    <AbsoluteFill style={{ backgroundColor: color.bg }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(58% 46% at ${x}% ${y}%, rgba(215,63,9,0.30), rgba(215,63,9,0.07) 55%, rgba(215,63,9,0) 100%)`
        }}
      />
      <AbsoluteFill
        style={{
          background: "radial-gradient(40% 34% at 12% -8%, rgba(255,255,255,0.055), rgba(255,255,255,0) 100%)"
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `url(${staticFile("noise.png")})`,
          backgroundSize: "320px 320px",
          opacity: 0.045,
          mixBlendMode: "overlay"
        }}
      />
    </AbsoluteFill>
  )
}

/* ---------- Icon ---------- */

/** The extension's icon on its white tile, as the popup shows it. */
export const IconTile: React.FC<{ readonly size: number; readonly style?: CSSProperties }> = ({ size, style }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: size * 0.235,
      backgroundColor: "#ffffff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: `0 ${size * 0.12}px ${size * 0.4}px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08), 0 0 ${size * 0.9}px rgba(215,63,9,0.22)`,
      ...style
    }}
  >
    <Img src={staticFile("icon.png")} style={{ width: size * 0.74, height: size * 0.74 }} />
  </div>
)

/* ---------- Headline type ---------- */

/**
 * One word that rises out of a mask at time `at` (seconds). The mask is the
 * word's own box, padded so descenders are not cut.
 */
export const RevealWord: React.FC<{
  readonly at: number
  readonly children: ReactNode
  readonly dur?: number
  readonly style?: CSSProperties
}> = ({ at, children, dur = 0.42, style }) => {
  const frame = useCurrentFrame()
  const p = prog(frame, at, at + dur, ease.out)
  return (
    <span
      style={{
        display: "inline-block",
        overflow: "hidden",
        padding: "0.08em 0.04em 0.16em",
        margin: "-0.08em -0.04em -0.16em",
        verticalAlign: "bottom"
      }}
    >
      <span
        style={{
          display: "inline-block",
          transform: `translateY(${(1 - p) * 108}%)`,
          opacity: p === 0 ? 0 : 1,
          ...style
        }}
      >
        {children}
      </span>
    </span>
  )
}

/** A line of big display type. Children are usually `RevealWord`s. */
export const Headline: React.FC<{
  readonly size: number
  readonly children: ReactNode
  readonly style?: CSSProperties
}> = ({ size, children, style }) => (
  <div
    style={{
      fontFamily: font.display,
      fontWeight: 800,
      fontSize: size,
      lineHeight: 1.0,
      letterSpacing: "-0.035em",
      display: "flex",
      justifyContent: "center",
      gap: "0.24em",
      whiteSpace: "nowrap",
      ...style
    }}
  >
    {children}
  </div>
)

/* ---------- Captions and the step label ---------- */

/** When each caption line comes in and when it leaves (seconds). */
const windows = CHUNKS.map((chunk, i) => {
  const start = WORDS[chunk.from]!.s - 0.16
  const lastEnd = WORDS[chunk.to]!.e
  const next = CHUNKS[i + 1]
  const nextStart = next ? WORDS[next.from]!.s - 0.16 : lastEnd + 0.5
  // A line stays until the next one arrives, unless the pause is long.
  const end = nextStart - lastEnd > 1.1 ? lastEnd + 0.6 : nextStart
  // The last line leaves with the email card.
  return { start, end: Math.min(end, T.emailOut + 0.1) }
})

/**
 * The caption under the browser. It never moves: each line sits in the same
 * place, dim at first, and its words light up as they are spoken.
 */
export const Captions: React.FC<{
  readonly top: number
  readonly size: number
  /** Set on a narrow canvas: lines wrap, balanced, inside this width. */
  readonly wrapWidth?: number
}> = ({ top, size, wrapWidth }) => {
  const frame = useCurrentFrame()
  const { width } = useVideoConfig()
  const t = frame / FPS
  const flow =
    wrapWidth === undefined
      ? ({ left: 0, right: 0, display: "flex", justifyContent: "center", gap: "0.25em", lineHeight: 1, whiteSpace: "nowrap" } as const)
      : ({ left: (width - wrapWidth) / 2, width: wrapWidth, textAlign: "center", lineHeight: 1.1, textWrap: "balance" } as const)
  return (
    <AbsoluteFill>
      {CHUNKS.map((chunk, i) => {
        const { start, end } = windows[i]!
        if (t < start - 0.05 || t > end + 0.3) return null
        const enter = prog(frame, start, start + 0.3, ease.out)
        // Gone just before the next line arrives, so two lines never overlap.
        const exit = prog(frame, end - 0.17, end - 0.02, ease.in)
        const words = WORDS.slice(chunk.from, chunk.to + 1)
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top,
              ...flow,
              fontFamily: font.display,
              fontWeight: 800,
              fontSize: size,
              letterSpacing: "-0.03em",
              opacity: enter * (1 - exit),
              transform: `translateY(${(1 - enter) * 22 - exit * 18}px)`
            }}
          >
            {words.map((word, j) => {
              const index = chunk.from + j
              const lit = prog(frame, word.s - 0.05, word.s + 0.12, ease.soft)
              const target = chunk.accent?.includes(index) ? color.accentText : color.ink
              return (
                <span
                  key={j}
                  style={{
                    display: "inline-block",
                    margin: wrapWidth === undefined ? undefined : "0 0.125em",
                    color: interpolateColors(lit, [0, 1], ["rgba(246,243,238,0.26)", target]),
                    transform: `translateY(${(1 - lit) * 5}px)`
                  }}
                >
                  {word.w}
                </span>
              )
            })}
          </div>
        )
      })}
    </AbsoluteFill>
  )
}

/** The small line above the caption: three bars and the name of the step. */
export const StageLabel: React.FC<{ readonly top: number; readonly size: number }> = ({ top, size }) => {
  const frame = useCurrentFrame()
  const t = frame / FPS
  const appear = prog(frame, T.windowIn + 0.25, T.windowIn + 0.7) * (1 - prog(frame, T.emailOut - 0.05, T.emailOut + 0.2, ease.in))
  if (appear === 0) return null
  const stageIndex = Math.max(
    0,
    STAGES.findLastIndex((stage) => t >= stage.start)
  )
  const stage = STAGES[stageIndex]!
  const swap = prog(frame, stage.start, stage.start + 0.35, ease.out)
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: size * 0.9,
        opacity: appear,
        fontFamily: font.mono,
        fontWeight: 500,
        fontSize: size,
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color: color.inkMuted
      }}
    >
      <div style={{ display: "flex", gap: size * 0.3 }}>
        {[1, 2, 3].map((n) => {
          const startOf = STAGES[n - 1]!.start
          const fill = prog(frame, startOf, startOf + 0.4, ease.out)
          return (
            <div key={n} style={{ width: size * 1.5, height: size * 0.25, borderRadius: 9, backgroundColor: "rgba(246,243,238,0.16)", overflow: "hidden" }}>
              <div style={{ width: `${fill * 100}%`, height: "100%", backgroundColor: color.accentText, borderRadius: 9 }} />
            </div>
          )
        })}
      </div>
      <div style={{ opacity: swap, transform: `translateY(${(1 - swap) * 8}px)`, display: "flex", gap: size * 0.7 }}>
        {stage.step <= 3 ? <span style={{ color: color.accentText }}>Step {stage.step}/3</span> : <span style={{ color: color.accentText }}>Done</span>}
        <span style={{ opacity: 0.5 }}>—</span>
        <span>{stage.label}</span>
      </div>
    </div>
  )
}

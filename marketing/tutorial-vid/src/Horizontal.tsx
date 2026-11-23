import { AbsoluteFill, Audio, Img, interpolate, spring, staticFile, useCurrentFrame } from "remotion"
import { WORDS } from "./captions"
import { Backdrop, Captions, Headline, IconTile, RevealWord, StageLabel } from "./components"
import { T } from "./edit"
import { color, ease, f, font, FOOTAGE, FPS, prog } from "./theme"
import { Walkthrough, type WalkLayout } from "./Walkthrough"

/**
 * The horizontal video (1920 x 1080, for YouTube and anywhere with a landscape
 * player). The whole Chrome window fits, at half the recording's pixels, with
 * the caption under it.
 */
export const H = {
  width: 1920,
  height: 1080,
  frame: { x: 192, y: 38, w: FOOTAGE.w, h: FOOTAGE.h, r: 18 },
  stageTop: 924,
  captionTop: 964
}

/** The camera. Times are seconds in the finished video; positions are footage points. */
const CAMERA = [
  { t: 6.65, dur: 0.75, x: 330, y: 150, s: 2.0 }, // the address bar
  { t: 8.02, dur: 0.68, x: 768, y: 432, s: 1.0 }, // the whole site
  { t: 8.75, dur: 0.6, x: 175, y: 340, s: 2.1 }, // the search panel
  { t: 10.98, dur: 0.5, x: 175, y: 400, s: 2.1 }, // follow it down to Search
  { t: 11.5, dur: 0.6, x: 380, y: 330, s: 1.75 }, // the results
  { t: 12.25, dur: 0.65, x: 960, y: 330, s: 1.5 }, // the course details
  { t: 12.9, dur: 0.95, x: 960, y: 334, s: 1.54 }, // (a slow drift while it is read)
  { t: 13.85, dur: 1.45, x: 1050, y: 470, s: 1.62 }, // down to All Sections
  { t: 15.6, dur: 0.7, x: 1010, y: 440, s: 2.0 }, // the rows
  { t: 16.5, dur: 0.75, x: 1000, y: 300, s: 1.7 }, // back to the top of the panel
  { t: 17.85, dur: 0.7, x: 880, y: 205, s: 2.7 }, // "Section 020, CRN 33846"
  { t: 18.55, dur: 1.3, x: 880, y: 205, s: 2.8 },
  { t: 19.85, dur: 0.9, x: 1010, y: 650, s: 1.9 }, // Notify me
  { t: 21.3, dur: 0.5, x: 872, y: 650, s: 2.3 }, // the sign-in form
  { t: 25.1, dur: 0.8, x: 850, y: 770, s: 2.7 }, // Watching
  { t: 25.9, dur: 2.65, x: 850, y: 770, s: 2.84 },
  { t: 28.55, dur: 0.95, x: 1240, y: 200, s: 1.9 }, // up to the toolbar
  { t: 30.5, dur: 0.7, x: 1223, y: 200, s: 2.3 }, // the popup
  { t: 31.2, dur: 3.2, x: 1223, y: 200, s: 2.4 }
]

const WIDE: WalkLayout = {
  frame: H.frame,
  camera: CAMERA,
  rest: { x: FOOTAGE.w / 2, y: FOOTAGE.h / 2, s: 1 },
  pointer: 40
}

/* ---------- The intro ---------- */

const at = (i: number) => WORDS[i]!.s - 0.07

/** A block that leaves upward between `from` and `to`. */
const exitStyle = (frame: number, from: number, to: number) => {
  const p = prog(frame, from, to, ease.in)
  return { opacity: 1 - p, transform: `translateY(${-46 * p}px) scale(${1 - 0.03 * p})` }
}

/** 0.0 - 2.75  "Tired of not getting the class you want?" */
const Hook: React.FC = () => {
  const frame = useCurrentFrame()
  const chip = prog(frame, 0.02, 0.5)
  const blink = 0.55 + 0.45 * Math.cos((frame / FPS) * Math.PI * 2 * 1.6)
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", ...exitStyle(frame, 2.5, 2.78) }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "12px 22px 12px 18px",
          borderRadius: 999,
          border: `1.5px solid ${color.line}`,
          backgroundColor: "rgba(246,243,238,0.04)",
          fontFamily: font.mono,
          fontWeight: 500,
          fontSize: 22,
          letterSpacing: "0.14em",
          color: color.inkMuted,
          marginBottom: 46,
          opacity: chip,
          transform: `translateY(${(1 - chip) * 14}px)`
        }}
      >
        <span
          style={{
            width: 11,
            height: 11,
            borderRadius: 99,
            backgroundColor: "#FF453A",
            opacity: blink,
            boxShadow: "0 0 14px rgba(255,69,58,0.9)"
          }}
        />
        CLASS FULL · 0 SEATS
      </div>
      <Headline size={142} style={{ color: color.ink }}>
        <RevealWord at={at(0)}>Tired</RevealWord>
        <RevealWord at={at(1)}>of</RevealWord>
        <RevealWord at={at(2)}>not</RevealWord>
        <RevealWord at={at(3)}>getting</RevealWord>
      </Headline>
      <Headline size={142} style={{ color: color.ink, marginTop: 10 }}>
        <RevealWord at={at(4)}>the</RevealWord>
        <RevealWord at={at(5)} style={{ color: color.accentText }}>
          class
        </RevealWord>
        <RevealWord at={at(6)}>you</RevealWord>
        <RevealWord at={at(7)}>want?</RevealWord>
      </Headline>
    </AbsoluteFill>
  )
}

/** 2.75 - 4.05  "Install the extension" */
const Install: React.FC = () => {
  const frame = useCurrentFrame()
  const pop = spring({ frame: frame - f(2.74), fps: FPS, config: { damping: 14, stiffness: 170, mass: 0.7 } })
  const pill = prog(frame, 3.12, 3.45)
  const pressed = prog(frame, 3.5, 3.62, ease.inOut)
  const added = prog(frame, 3.6, 3.8)
  const dip = Math.sin(Math.min(1, Math.max(0, (frame - f(3.48)) / f(0.22))) * Math.PI)
  if (frame < f(2.7) || frame > f(4.2)) return null
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", ...exitStyle(frame, 3.92, 4.14) }}>
      <IconTile size={184} style={{ transform: `scale(${0.5 + 0.5 * pop}) rotate(${(1 - pop) * -10}deg)`, opacity: Math.min(1, pop * 1.6) }} />
      <Headline size={124} style={{ color: color.ink, marginTop: 52 }}>
        <RevealWord at={at(8)}>Install</RevealWord>
        <RevealWord at={at(9)}>the</RevealWord>
        <RevealWord at={at(10)} style={{ color: color.accentText }}>
          extension
        </RevealWord>
      </Headline>
      <div
        style={{
          marginTop: 50,
          height: 78,
          padding: "0 38px",
          borderRadius: 999,
          display: "flex",
          alignItems: "center",
          gap: 14,
          fontFamily: font.text,
          fontWeight: 600,
          fontSize: 32,
          letterSpacing: "-0.01em",
          color: interpolate(pressed, [0, 1], [0, 1]) > 0.5 ? "#ffffff" : color.bg,
          backgroundColor: pressed > 0.5 ? color.accent : color.ink,
          opacity: pill,
          transform: `translateY(${(1 - pill) * 16}px) scale(${1 - 0.07 * dip})`,
          boxShadow: pressed > 0.5 ? "0 10px 40px rgba(215,63,9,0.45)" : "0 10px 40px rgba(0,0,0,0.4)"
        }}
      >
        {added > 0 ? (
          <>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12.5l4.5 4.5L19 7.5"
                stroke="#fff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray="24"
                strokeDashoffset={24 * (1 - added)}
              />
            </svg>
            Added to Chrome
          </>
        ) : (
          "Add to Chrome"
        )}
      </div>
    </AbsoluteFill>
  )
}

/** 4.0 - 6.35  "and you only have three easy steps left." */
const ThreeSteps: React.FC = () => {
  const frame = useCurrentFrame()
  const three = spring({ frame: frame - f(at(15) - 0.02), fps: FPS, config: { damping: 13, stiffness: 190, mass: 0.8 } })
  const eyebrow = prog(frame, 4.02, 4.4)
  if (frame < f(3.95)) return null
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", ...exitStyle(frame, 6.0, 6.3) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 64 }}>
        <div
          style={{
            fontFamily: font.display,
            fontWeight: 800,
            fontSize: 520,
            lineHeight: 0.8,
            letterSpacing: "-0.06em",
            color: color.accentText,
            transform: `scale(${1.5 - 0.5 * three})`,
            opacity: Math.min(1, three * 2),
            textShadow: "0 0 120px rgba(215,63,9,0.55)",
            marginTop: -30
          }}
        >
          3
        </div>
        <div>
          <div
            style={{
              fontFamily: font.mono,
              fontWeight: 500,
              fontSize: 26,
              letterSpacing: "0.16em",
              color: color.inkMuted,
              marginBottom: 26,
              marginLeft: 6,
              opacity: eyebrow,
              transform: `translateY(${(1 - eyebrow) * 12}px)`
            }}
          >
            AND YOU ONLY HAVE
          </div>
          <Headline size={150} style={{ color: color.ink, justifyContent: "flex-start" }}>
            <RevealWord at={at(16)}>easy</RevealWord>
            <RevealWord at={at(17)}>steps</RevealWord>
          </Headline>
          <Headline size={150} style={{ color: color.inkMuted, justifyContent: "flex-start", marginTop: 8 }}>
            <RevealWord at={at(18)}>left.</RevealWord>
          </Headline>
        </div>
      </div>
    </AbsoluteFill>
  )
}

const Intro: React.FC = () => {
  const frame = useCurrentFrame()
  if (frame > f(6.4)) return null
  return (
    <AbsoluteFill>
      {frame < f(2.85) ? <Hook /> : null}
      <Install />
      <ThreeSteps />
    </AbsoluteFill>
  )
}

/* ---------- The email card ---------- */

const CLASS = "DATA STRUCTURES (CRN 33846)"

const WIDTH = 1060
const HEAD = 218
const BODY = 368

/**
 * 32.2 - 35.5  "and you will get an email the moment a seat opens."
 * The card is the server's real seat-opened email (apps/server/src/emails.ts):
 * same subject, same sentences, same button. It lands as a notification, then
 * opens.
 */
const EmailScene: React.FC = () => {
  const frame = useCurrentFrame()
  if (frame < f(T.emailIn) || frame > f(T.emailOut + 0.4)) return null

  const drop = spring({ frame: frame - f(T.emailIn + 0.12), fps: FPS, config: { damping: 15, stiffness: 150, mass: 0.8 } })
  const open = prog(frame, 33.55, 34.25, ease.inOut)
  const exit = prog(frame, T.emailOut, T.emailOut + 0.3, ease.in)
  const ping = prog(frame, T.emailIn + 0.3, T.emailIn + 1.0, ease.out)

  const height = HEAD + BODY * open
  const top = 150 + (1 - open) * 190

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: (H.width - WIDTH) / 2,
          top,
          width: WIDTH,
          height,
          borderRadius: 36,
          overflow: "hidden",
          backgroundColor: "#ffffff",
          color: "#1c1b1a",
          fontFamily: font.text,
          boxShadow: "0 60px 140px rgba(0,0,0,0.6), 0 14px 40px rgba(0,0,0,0.35), 0 0 140px rgba(215,63,9,0.24)",
          opacity: Math.min(1, drop * 1.8) * (1 - exit),
          transform: `translateY(${(1 - drop) * -150 - exit * 30}px) scale(${0.92 + 0.08 * drop - 0.04 * exit})`
        }}
      >
        {/* The inbox line: who, when, subject. */}
        <div style={{ height: HEAD, padding: "38px 44px 0", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ position: "relative" }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 17,
                  border: "2px solid #e3e3df",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#fff"
                }}
              >
                <Img src={staticFile("icon.png")} style={{ width: 46, height: 46 }} />
              </div>
              <div
                style={{
                  position: "absolute",
                  right: -6,
                  top: -6,
                  width: 20,
                  height: 20,
                  borderRadius: 99,
                  backgroundColor: color.accent,
                  border: "4px solid #fff",
                  boxShadow: `0 0 0 ${ping * 18}px rgba(215,63,9,${0.35 * (1 - ping)})`
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 29, letterSpacing: "-0.01em" }}>GetTheDamClass</div>
              <div style={{ fontSize: 23, color: "#5f5e5a", marginTop: 1 }}>to you</div>
            </div>
            <div style={{ fontFamily: font.mono, fontSize: 20, letterSpacing: "0.1em", color: "#8a8a85" }}>NOW</div>
          </div>
          <div style={{ marginTop: 26, fontWeight: 700, fontSize: 43, letterSpacing: "-0.025em", whiteSpace: "nowrap" }}>
            <span style={{ color: color.accent }}>Seat open:</span> {CLASS}
          </div>
        </div>

        {/* The message itself. */}
        <div style={{ height: BODY, backgroundColor: "#f4f4f4", padding: "30px 44px 44px", boxSizing: "border-box" }}>
          <div
            style={{
              backgroundColor: "#fff",
              borderTop: `6px solid ${color.accent}`,
              padding: "30px 38px",
              fontSize: 28,
              lineHeight: 1.45,
              color: "#222",
              height: "100%",
              boxSizing: "border-box"
            }}
          >
            <div>
              A seat just opened in <b>{CLASS}</b>. Seats go fast, so register now.
            </div>
            <div style={{ fontWeight: 700, fontSize: 44, letterSpacing: "0.08em", margin: "16px 0 20px", lineHeight: 1.2 }}>CRN 33846</div>
            <div
              style={{
                display: "inline-block",
                padding: "14px 30px",
                backgroundColor: color.accent,
                color: "#fff",
                fontWeight: 700,
                borderRadius: 7
              }}
            >
              Open the class search
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}

/* ---------- The end card ---------- */


/** 35.6 - 37.2  "What are you waiting for?" */
const Question: React.FC = () => {
  const frame = useCurrentFrame()
  if (frame > f(T.lockupIn + 0.1)) return null
  const exit = prog(frame, T.lockupIn - 0.14, T.lockupIn + 0.02, ease.in)
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: 1 - exit, transform: `scale(${1 - 0.05 * exit})` }}>
      <Headline size={136} style={{ color: color.ink }}>
        <RevealWord at={at(101)} dur={0.34}>
          What
        </RevealWord>
        <RevealWord at={at(102)} dur={0.34}>
          are
        </RevealWord>
        <RevealWord at={at(103)} dur={0.34}>
          you
        </RevealWord>
        <RevealWord at={at(104)} dur={0.34} style={{ color: color.accentText }}>
          waiting
        </RevealWord>
        <RevealWord at={at(105)} dur={0.34}>
          for?
        </RevealWord>
      </Headline>
    </AbsoluteFill>
  )
}

/** A word of the name that lands with a little weight as it is said. */
const Punch: React.FC<{ readonly at: number; readonly children: string; readonly accent?: boolean }> = ({ at: time, children, accent }) => {
  const frame = useCurrentFrame()
  const p = spring({ frame: frame - f(time), fps: FPS, config: { damping: 13, stiffness: 210, mass: 0.7 } })
  return (
    <span
      style={{
        display: "inline-block",
        color: accent ? color.accentText : color.ink,
        opacity: Math.min(1, p * 2.2),
        transform: `translateY(${(1 - p) * 46}px) scale(${1.22 - 0.22 * p})`,
        textShadow: accent ? "0 0 90px rgba(215,63,9,0.6)" : undefined
      }}
    >
      {children}
    </span>
  )
}

/** 37.2 - end  "Get the Dam Class!", held through the music. */
const Lockup: React.FC = () => {
  const frame = useCurrentFrame()
  if (frame < f(T.lockupIn - 0.05)) return null
  const tile = spring({ frame: frame - f(T.lockupIn), fps: FPS, config: { damping: 14, stiffness: 160, mass: 0.8 } })
  const settle = prog(frame, 38.75, 39.6, ease.inOut)
  const tagline = prog(frame, 39.0, 39.7, ease.out)
  const pill = prog(frame, 39.3, 40.0, ease.out)
  const drift = prog(frame, T.lockupIn, T.end, (n) => n)
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${1 + 0.035 * drift})` }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", transform: `translateY(${-settle * 34}px)` }}>
        <IconTile size={150} style={{ transform: `scale(${0.4 + 0.6 * tile}) rotate(${(1 - tile) * 14}deg)`, opacity: Math.min(1, tile * 2) }} />
        <div
          style={{
            marginTop: 46,
            fontFamily: font.display,
            fontWeight: 800,
            fontSize: 172,
            lineHeight: 1,
            letterSpacing: "-0.045em",
            display: "flex",
            gap: "0.2em",
            whiteSpace: "nowrap"
          }}
        >
          <Punch at={at(106)}>Get</Punch>
          <Punch at={at(107)}>The</Punch>
          <Punch at={at(108)} accent>
            Dam
          </Punch>
          <Punch at={at(109)}>Class</Punch>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 724,
          left: 0,
          right: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 34
        }}
      >
        <div
          style={{
            fontFamily: font.text,
            fontWeight: 500,
            fontSize: 44,
            letterSpacing: "-0.015em",
            color: color.inkMuted,
            opacity: tagline,
            transform: `translateY(${(1 - tagline) * 16}px)`
          }}
        >
          Seat alerts for Oregon State classes.
        </div>
        <div
          style={{
            height: 82,
            padding: "0 40px",
            borderRadius: 999,
            display: "flex",
            alignItems: "center",
            gap: 12,
            backgroundColor: color.accent,
            color: "#fff",
            fontFamily: font.text,
            fontWeight: 600,
            fontSize: 33,
            letterSpacing: "-0.01em",
            boxShadow: "0 14px 50px rgba(215,63,9,0.5)",
            opacity: pill,
            transform: `translateY(${(1 - pill) * 16}px)`
          }}
        >
          Add to Chrome
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </AbsoluteFill>
  )
}

const Outro: React.FC = () => {
  const frame = useCurrentFrame()
  if (frame < f(T.outroIn)) return null
  return (
    <AbsoluteFill>
      <Question />
      <Lockup />
    </AbsoluteFill>
  )
}

/* ---------- The video ---------- */

export const TutorialHorizontal: React.FC = () => {
  const frame = useCurrentFrame()
  const black = 1 - prog(frame, 0, 0.3) + prog(frame, T.end - 0.75, T.end - 0.05, (n) => n)
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Backdrop />
      <Intro />
      <Walkthrough layout={WIDE} />
      <StageLabel top={H.stageTop} size={20} />
      <Captions top={H.captionTop} size={68} />
      <EmailScene />
      <Outro />
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: Math.min(1, black) }} />
      <Audio src={staticFile("script-audio.wav")} />
    </AbsoluteFill>
  )
}

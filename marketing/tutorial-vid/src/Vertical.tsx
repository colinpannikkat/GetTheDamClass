import { AbsoluteFill, Audio, Img, spring, staticFile, useCurrentFrame } from "remotion"
import { WORDS } from "./captions"
import { Backdrop, Captions, Headline, IconTile, RevealWord, StageLabel } from "./components"
import { T } from "./edit"
import { color, ease, f, font, FPS, prog } from "./theme"
import { Walkthrough, type WalkLayout } from "./Walkthrough"

// Apps draw their own interface over the top ~250 px, the bottom ~400 px and the lower right edge,
// so everything that matters stays between.
export const V = {
  width: 1080,
  height: 1920,
  brandTop: 192,
  frame: { x: 48, y: 278, w: 984, h: 984, r: 40 },
  stageTop: 1298,
  captionTop: 1354
}

const CAMERA = [
  { t: 6.65, dur: 0.75, x: 292, y: 150, s: 2.4 },
  { t: 8.02, dur: 0.68, x: 240, y: 330, s: 1.9 },
  { t: 8.75, dur: 0.6, x: 175, y: 340, s: 2.5 },
  { t: 10.98, dur: 0.5, x: 175, y: 400, s: 2.5 },
  { t: 11.5, dur: 0.45, x: 432, y: 330, s: 1.75 },
  { t: 12.25, dur: 0.65, x: 1000, y: 330, s: 1.5 },
  { t: 12.9, dur: 0.95, x: 1000, y: 334, s: 1.55 },
  { t: 13.85, dur: 1.45, x: 1000, y: 480, s: 1.55 },
  { t: 15.6, dur: 0.7, x: 962, y: 446, s: 1.9 },
  { t: 16.5, dur: 0.75, x: 985, y: 340, s: 1.6 },
  { t: 17.85, dur: 0.7, x: 892, y: 215, s: 2.2 },
  { t: 18.55, dur: 1.3, x: 892, y: 215, s: 2.28 },
  { t: 19.85, dur: 0.9, x: 880, y: 650, s: 2.0 },
  { t: 21.3, dur: 0.5, x: 872, y: 640, s: 2.6 },
  { t: 25.1, dur: 0.8, x: 884, y: 770, s: 2.5 },
  { t: 25.9, dur: 2.65, x: 884, y: 770, s: 2.62 },
  { t: 28.55, dur: 0.95, x: 1290, y: 200, s: 2.0 },
  { t: 30.5, dur: 0.7, x: 1223, y: 215, s: 2.6 },
  { t: 31.2, dur: 3.2, x: 1223, y: 215, s: 2.7 }
]

const TALL: WalkLayout = {
  frame: V.frame,
  camera: CAMERA,
  rest: { x: 768, y: 432, s: V.frame.h / 864 },
  pointer: 52
}

const at = (i: number) => WORDS[i]!.s - 0.07

const exitStyle = (frame: number, from: number, to: number) => {
  const p = prog(frame, from, to, ease.in)
  return { opacity: 1 - p, transform: `translateY(${-60 * p}px) scale(${1 - 0.03 * p})` }
}

const stage = { alignItems: "center", justifyContent: "center", paddingBottom: 150 } as const

const SIZE = 156

const Hook: React.FC = () => {
  const frame = useCurrentFrame()
  const chip = prog(frame, 0.02, 0.5)
  const blink = 0.55 + 0.45 * Math.cos((frame / FPS) * Math.PI * 2 * 1.6)
  return (
    <AbsoluteFill style={{ ...stage, ...exitStyle(frame, 2.5, 2.78) }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "16px 30px 16px 24px",
          borderRadius: 999,
          border: `2px solid ${color.line}`,
          backgroundColor: "rgba(246,243,238,0.04)",
          fontFamily: font.mono,
          fontWeight: 500,
          fontSize: 30,
          letterSpacing: "0.14em",
          color: color.inkMuted,
          marginBottom: 64,
          opacity: chip,
          transform: `translateY(${(1 - chip) * 14}px)`
        }}
      >
        <span style={{ width: 15, height: 15, borderRadius: 99, backgroundColor: "#FF453A", opacity: blink, boxShadow: "0 0 18px rgba(255,69,58,0.9)" }} />
        CLASS FULL · 0 SEATS
      </div>
      <Headline size={SIZE} style={{ color: color.ink }}>
        <RevealWord at={at(0)}>Tired</RevealWord>
        <RevealWord at={at(1)}>of</RevealWord>
      </Headline>
      <Headline size={SIZE} style={{ color: color.ink, marginTop: 6 }}>
        <RevealWord at={at(2)}>not</RevealWord>
        <RevealWord at={at(3)}>getting</RevealWord>
      </Headline>
      <Headline size={SIZE} style={{ color: color.ink, marginTop: 6 }}>
        <RevealWord at={at(4)}>the</RevealWord>
        <RevealWord at={at(5)} style={{ color: color.accentText }}>
          class
        </RevealWord>
      </Headline>
      <Headline size={SIZE} style={{ color: color.ink, marginTop: 6 }}>
        <RevealWord at={at(6)}>you</RevealWord>
        <RevealWord at={at(7)}>want?</RevealWord>
      </Headline>
    </AbsoluteFill>
  )
}

const Install: React.FC = () => {
  const frame = useCurrentFrame()
  const pop = spring({ frame: frame - f(2.74), fps: FPS, config: { damping: 14, stiffness: 170, mass: 0.7 } })
  const pill = prog(frame, 3.12, 3.45)
  const pressed = prog(frame, 3.5, 3.62, ease.inOut) > 0.5
  const added = prog(frame, 3.6, 3.8)
  const dip = Math.sin(Math.min(1, Math.max(0, (frame - f(3.48)) / f(0.22))) * Math.PI)
  if (frame < f(2.7) || frame > f(4.2)) return null
  return (
    <AbsoluteFill style={{ ...stage, ...exitStyle(frame, 3.92, 4.14) }}>
      <IconTile size={250} style={{ transform: `scale(${0.5 + 0.5 * pop}) rotate(${(1 - pop) * -10}deg)`, opacity: Math.min(1, pop * 1.6) }} />
      <Headline size={SIZE} style={{ color: color.ink, marginTop: 76 }}>
        <RevealWord at={at(8)}>Install</RevealWord>
        <RevealWord at={at(9)}>the</RevealWord>
      </Headline>
      <Headline size={SIZE} style={{ color: color.accentText, marginTop: 6 }}>
        <RevealWord at={at(10)}>extension</RevealWord>
      </Headline>
      <div
        style={{
          marginTop: 70,
          height: 104,
          padding: "0 50px",
          borderRadius: 999,
          display: "flex",
          alignItems: "center",
          gap: 16,
          fontFamily: font.text,
          fontWeight: 600,
          fontSize: 42,
          letterSpacing: "-0.01em",
          color: pressed ? "#ffffff" : color.bg,
          backgroundColor: pressed ? color.accent : color.ink,
          opacity: pill,
          transform: `translateY(${(1 - pill) * 18}px) scale(${1 - 0.07 * dip})`,
          boxShadow: pressed ? "0 14px 54px rgba(215,63,9,0.45)" : "0 14px 54px rgba(0,0,0,0.4)"
        }}
      >
        {added > 0 ? (
          <>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
              <path d="M5 12.5l4.5 4.5L19 7.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="24" strokeDashoffset={24 * (1 - added)} />
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

const ThreeSteps: React.FC = () => {
  const frame = useCurrentFrame()
  const three = spring({ frame: frame - f(at(15) - 0.02), fps: FPS, config: { damping: 13, stiffness: 190, mass: 0.8 } })
  const eyebrow = prog(frame, 4.02, 4.4)
  if (frame < f(3.95)) return null
  return (
    <AbsoluteFill style={{ ...stage, ...exitStyle(frame, 6.0, 6.3) }}>
      <div
        style={{
          fontFamily: font.mono,
          fontWeight: 500,
          fontSize: 34,
          letterSpacing: "0.16em",
          color: color.inkMuted,
          opacity: eyebrow,
          transform: `translateY(${(1 - eyebrow) * 12}px)`
        }}
      >
        AND YOU ONLY HAVE
      </div>
      <div
        style={{
          fontFamily: font.display,
          fontWeight: 800,
          fontSize: 700,
          lineHeight: 0.84,
          letterSpacing: "-0.06em",
          color: color.accentText,
          transform: `scale(${1.5 - 0.5 * three})`,
          opacity: Math.min(1, three * 2),
          textShadow: "0 0 150px rgba(215,63,9,0.55)",
          marginTop: 10,
          marginBottom: 30
        }}
      >
        3
      </div>
      <Headline size={SIZE} style={{ color: color.ink }}>
        <RevealWord at={at(16)}>easy</RevealWord>
        <RevealWord at={at(17)}>steps</RevealWord>
      </Headline>
      <Headline size={SIZE} style={{ color: color.inkMuted, marginTop: 6 }}>
        <RevealWord at={at(18)}>left.</RevealWord>
      </Headline>
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

const WIDTH = 944
const HEAD = 330
const BODY = 486

// The server's real seat-opened email (apps/server/src/emails.ts), laid out for a narrow screen.
const EmailScene: React.FC = () => {
  const frame = useCurrentFrame()
  if (frame < f(T.emailIn) || frame > f(T.emailOut + 0.4)) return null

  const drop = spring({ frame: frame - f(T.emailIn + 0.12), fps: FPS, config: { damping: 15, stiffness: 150, mass: 0.8 } })
  const open = prog(frame, 33.55, 34.25, ease.inOut)
  const exit = prog(frame, T.emailOut, T.emailOut + 0.3, ease.in)
  const ping = prog(frame, T.emailIn + 0.3, T.emailIn + 1.0, ease.out)

  const height = HEAD + BODY * open
  const top = V.frame.y + (V.frame.h - height) / 2

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: (V.width - WIDTH) / 2,
          top,
          width: WIDTH,
          height,
          borderRadius: 44,
          overflow: "hidden",
          backgroundColor: "#ffffff",
          color: "#1c1b1a",
          fontFamily: font.text,
          boxShadow: "0 60px 140px rgba(0,0,0,0.6), 0 14px 40px rgba(0,0,0,0.35), 0 0 150px rgba(215,63,9,0.26)",
          opacity: Math.min(1, drop * 1.8) * (1 - exit),
          transform: `translateY(${(1 - drop) * -170 - exit * 30}px) scale(${0.92 + 0.08 * drop - 0.04 * exit})`
        }}
      >
        <div style={{ height: HEAD, padding: "44px 48px 0", boxSizing: "border-box" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div style={{ position: "relative" }}>
              <div
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: 22,
                  border: "2px solid #e3e3df",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#fff"
                }}
              >
                <Img src={staticFile("icon.png")} style={{ width: 60, height: 60 }} />
              </div>
              <div
                style={{
                  position: "absolute",
                  right: -7,
                  top: -7,
                  width: 26,
                  height: 26,
                  borderRadius: 99,
                  backgroundColor: color.accent,
                  border: "5px solid #fff",
                  boxShadow: `0 0 0 ${ping * 22}px rgba(215,63,9,${0.35 * (1 - ping)})`
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 38, letterSpacing: "-0.01em" }}>GetTheDamClass</div>
              <div style={{ fontSize: 30, color: "#5f5e5a", marginTop: 1 }}>to you</div>
            </div>
            <div style={{ fontFamily: font.mono, fontSize: 26, letterSpacing: "0.1em", color: "#8a8a85" }}>NOW</div>
          </div>
          <div style={{ marginTop: 32, fontWeight: 700, fontSize: 54, lineHeight: 1.14, letterSpacing: "-0.025em" }}>
            <div style={{ color: color.accent }}>Seat open:</div>
            <div style={{ whiteSpace: "nowrap" }}>DATA STRUCTURES (CRN 33846)</div>
          </div>
        </div>

        <div style={{ height: BODY, backgroundColor: "#f4f4f4", padding: "34px 48px 48px", boxSizing: "border-box" }}>
          <div
            style={{
              backgroundColor: "#fff",
              borderTop: `7px solid ${color.accent}`,
              padding: "36px 40px",
              fontSize: 36,
              lineHeight: 1.42,
              color: "#222",
              height: "100%",
              boxSizing: "border-box"
            }}
          >
            <div>
              A seat just opened in <b>DATA STRUCTURES (CRN 33846)</b>. Seats go fast, so register now.
            </div>
            <div style={{ fontWeight: 700, fontSize: 58, letterSpacing: "0.08em", margin: "22px 0 26px", lineHeight: 1.2 }}>CRN 33846</div>
            <div style={{ display: "inline-block", padding: "18px 38px", backgroundColor: color.accent, color: "#fff", fontWeight: 700, borderRadius: 9 }}>
              Open the class search
            </div>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}


const Question: React.FC = () => {
  const frame = useCurrentFrame()
  if (frame > f(T.lockupIn + 0.1)) return null
  const exit = prog(frame, T.lockupIn - 0.14, T.lockupIn + 0.02, ease.in)
  return (
    <AbsoluteFill style={{ ...stage, opacity: 1 - exit, transform: `scale(${1 - 0.05 * exit})` }}>
      <Headline size={146} style={{ color: color.ink }}>
        <RevealWord at={at(101)} dur={0.34}>
          What
        </RevealWord>
        <RevealWord at={at(102)} dur={0.34}>
          are
        </RevealWord>
        <RevealWord at={at(103)} dur={0.34}>
          you
        </RevealWord>
      </Headline>
      <Headline size={146} style={{ color: color.ink, marginTop: 6 }}>
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

const Punch: React.FC<{ readonly at: number; readonly children: string; readonly accent?: boolean }> = ({ at: time, children, accent }) => {
  const frame = useCurrentFrame()
  const p = spring({ frame: frame - f(time), fps: FPS, config: { damping: 13, stiffness: 210, mass: 0.7 } })
  return (
    <span
      style={{
        display: "inline-block",
        color: accent ? color.accentText : color.ink,
        opacity: Math.min(1, p * 2.2),
        transform: `translateY(${(1 - p) * 50}px) scale(${1.22 - 0.22 * p})`,
        textShadow: accent ? "0 0 100px rgba(215,63,9,0.6)" : undefined
      }}
    >
      {children}
    </span>
  )
}

const nameLine = {
  fontFamily: font.display,
  fontWeight: 800,
  fontSize: 182,
  lineHeight: 1.0,
  letterSpacing: "-0.045em",
  display: "flex",
  gap: "0.2em",
  whiteSpace: "nowrap"
} as const

const Lockup: React.FC = () => {
  const frame = useCurrentFrame()
  if (frame < f(T.lockupIn - 0.05)) return null
  const tile = spring({ frame: frame - f(T.lockupIn), fps: FPS, config: { damping: 14, stiffness: 160, mass: 0.8 } })
  const tagline = prog(frame, 39.0, 39.7, ease.out)
  const pill = prog(frame, 39.3, 40.0, ease.out)
  const drift = prog(frame, T.lockupIn, T.end, (n) => n)
  return (
    <AbsoluteFill style={{ ...stage, transform: `scale(${1 + 0.035 * drift})` }}>
      <IconTile size={220} style={{ transform: `scale(${0.4 + 0.6 * tile}) rotate(${(1 - tile) * 14}deg)`, opacity: Math.min(1, tile * 2) }} />
      <div style={{ ...nameLine, marginTop: 70 }}>
        <Punch at={at(106)}>Get</Punch>
        <Punch at={at(107)}>The</Punch>
      </div>
      <div style={nameLine}>
        <Punch at={at(108)} accent>
          Dam
        </Punch>
        <Punch at={at(109)}>Class</Punch>
      </div>
      <div
        style={{
          marginTop: 64,
          fontFamily: font.text,
          fontWeight: 500,
          fontSize: 48,
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
          marginTop: 52,
          height: 108,
          padding: "0 54px",
          borderRadius: 999,
          display: "flex",
          alignItems: "center",
          gap: 16,
          backgroundColor: color.accent,
          color: "#fff",
          fontFamily: font.text,
          fontWeight: 600,
          fontSize: 44,
          letterSpacing: "-0.01em",
          boxShadow: "0 16px 60px rgba(215,63,9,0.5)",
          opacity: pill,
          transform: `translateY(${(1 - pill) * 16}px)`
        }}
      >
        Add to Chrome
        <svg width="38" height="38" viewBox="0 0 24 24" fill="none">
          <path d="M5 12h14M13 6l6 6-6 6" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
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

const BrandChip: React.FC = () => {
  const frame = useCurrentFrame()
  const on = prog(frame, T.windowIn + 0.2, T.windowIn + 0.7) * (1 - prog(frame, T.emailOut - 0.05, T.emailOut + 0.2, ease.in))
  if (on === 0) return null
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: V.brandTop,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 18,
        opacity: on,
        transform: `translateY(${(1 - on) * -10}px)`,
        fontFamily: font.text,
        fontWeight: 600,
        fontSize: 36,
        letterSpacing: "-0.015em",
        color: color.ink
      }}
    >
      <div style={{ width: 58, height: 58, borderRadius: 15, backgroundColor: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Img src={staticFile("icon.png")} style={{ width: 43, height: 43 }} />
      </div>
      GetTheDamClass
    </div>
  )
}

export const TutorialVertical: React.FC = () => {
  const frame = useCurrentFrame()
  const black = 1 - prog(frame, 0, 0.3) + prog(frame, T.end - 0.75, T.end - 0.05, (n) => n)
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Backdrop />
      <Intro />
      <BrandChip />
      <Walkthrough layout={TALL} />
      <StageLabel top={V.stageTop} size={27} />
      <Captions top={V.captionTop} size={80} wrapWidth={1000} />
      <EmailScene />
      <Outro />
      <AbsoluteFill style={{ backgroundColor: "#000", opacity: Math.min(1, black) }} />
      <Audio src={staticFile("script-audio.wav")} />
    </AbsoluteFill>
  )
}

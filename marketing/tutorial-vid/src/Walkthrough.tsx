import { AbsoluteFill, Freeze, OffthreadVideo, Sequence, staticFile, useCurrentFrame } from "remotion"
import { CURSOR, CURSOR_HIDDEN, pageBottom, SEGMENTS, SPOTS, T, type CursorKey } from "./edit"
import { color, ease, f, FOOTAGE, FPS, lerp, prog } from "./theme"

export interface CamKey {
  readonly t: number
  readonly dur: number
  readonly x: number
  readonly y: number
  readonly s: number
}

export interface CamState {
  readonly x: number
  readonly y: number
  readonly s: number
}

const cameraAt = (keys: ReadonlyArray<CamKey>, time: number, rest: CamState): CamState => {
  let state = rest
  for (const key of keys) {
    if (time >= key.t + key.dur) {
      state = key
      continue
    }
    if (time > key.t) {
      const p = ease.inOut((time - key.t) / key.dur)
      // Zoom in log space, so a push-in feels even from start to end.
      const s = Math.exp(lerp(Math.log(state.s), Math.log(key.s), p))
      state = { x: lerp(state.x, key.x, p), y: lerp(state.y, key.y, p), s }
    }
    break
  }
  return state
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

const cameraTransform = (cam: CamState, bottom: number, view: { readonly w: number; readonly h: number }) => {
  // Never zoomed out so far that the view would show past the footage, or the strip under `bottom`.
  const s = Math.max(cam.s, view.h / bottom, view.w / FOOTAGE.w)
  const tx = clamp(view.w / 2 - cam.x * s, view.w - FOOTAGE.w * s, 0)
  const ty = clamp(view.h / 2 - cam.y * s, view.h - bottom * s, 0)
  return { tx, ty, s }
}

const cursorAt = (keys: ReadonlyArray<CursorKey>, time: number) => {
  let x = keys[0]?.x ?? 0
  let y = keys[0]?.y ?? 0
  for (const key of keys) {
    if (time >= key.t + key.dur) {
      x = key.x
      y = key.y
      continue
    }
    if (time > key.t) {
      const p = ease.inOut((time - key.t) / key.dur)
      // A slight arc: real hands do not move in straight lines.
      const dx = key.x - x
      const dy = key.y - y
      const bow = Math.sin(p * Math.PI) * Math.min(26, Math.hypot(dx, dy) * 0.07)
      const len = Math.hypot(dx, dy) || 1
      x = lerp(x, key.x, p) + (-dy / len) * bow
      y = lerp(y, key.y, p) + (dx / len) * bow
    }
    break
  }
  return { x, y }
}

const Footage: React.FC = () => {
  const style = { position: "absolute", left: 0, top: 0, width: FOOTAGE.w, height: FOOTAGE.h, display: "block" } as const
  return (
    <>
      {SEGMENTS.map((segment, i) => {
        const from = f(segment.out)
        const duration = f(segment.outEnd) - from
        if (duration <= 0) return null
        const src = staticFile(segment.file)
        const trimBefore = Math.round(segment.src * FPS)
        return (
          <Sequence key={i} from={from} durationInFrames={duration} layout="none">
            {segment.srcEnd === undefined ? (
              <Freeze frame={0}>
                <OffthreadVideo src={src} trimBefore={trimBefore} muted style={style} />
              </Freeze>
            ) : (
              <OffthreadVideo
                src={src}
                trimBefore={trimBefore}
                playbackRate={(segment.srcEnd - segment.src) / (segment.outEnd - segment.out)}
                muted
                style={style}
              />
            )}
          </Sequence>
        )
      })}
    </>
  )
}

const Pointer: React.FC<{ readonly x: number; readonly y: number; readonly press: number; readonly opacity: number; readonly scale: number }> = ({
  x,
  y,
  press,
  opacity,
  scale
}) => {
  const size = 40 * scale * (1 - 0.14 * press)
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{
        position: "absolute",
        left: x - (size * 5.2) / 24,
        top: y - (size * 2.6) / 24,
        opacity,
        filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.38))",
        overflow: "visible"
      }}
    >
      <path d="M5.2 2.6v17.2l4.5-4.2 2.9 6.7 2.9-1.25-2.9-6.6h6.3L5.2 2.6z" fill="#141414" stroke="#ffffff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

export interface WalkLayout {
  readonly frame: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number }
  readonly camera: ReadonlyArray<CamKey>
  readonly rest: CamState
  readonly pointer: number
}

export const Walkthrough: React.FC<{ readonly layout: WalkLayout }> = ({ layout }) => {
  const view = layout.frame
  const k = layout.pointer / 40
  const frame = useCurrentFrame()
  const t = frame / FPS
  if (t < T.windowIn - 0.05 || t > T.outroIn + 0.45) return null

  const enter = prog(frame, T.windowIn, T.windowIn + 0.8, ease.out)
  const recede = prog(frame, T.emailIn, T.emailIn + 0.55, ease.inOut)
  const exit = prog(frame, T.emailOut, T.emailOut + 0.3, ease.in)

  const cam = cameraTransform(cameraAt(layout.camera, t, layout.rest), pageBottom(t), view)
  const toWindow = (x: number, y: number) => ({ x: cam.tx + x * cam.s, y: cam.ty + y * cam.s })

  const pointer = cursorAt(CURSOR, t)
  const p = toWindow(pointer.x, pointer.y)
  const hidden = CURSOR_HIDDEN.reduce((acc, [from, to]) => Math.max(acc, prog(frame, from, from + 0.18) * (1 - prog(frame, to, to + 0.18))), 0)
  const firstMove = CURSOR[0]?.t ?? 0
  const pointerOpacity = prog(frame, firstMove, firstMove + 0.25) * (1 - hidden) * (1 - recede)

  const clicks = CURSOR.filter((key) => key.click).map((key) => ({ at: key.t + key.dur, x: key.x, y: key.y }))
  const press = clicks.reduce((acc, click) => {
    const d = (t - click.at) / 0.16
    return Math.max(acc, d > -0.6 && d < 1 ? Math.sin(((d + 0.6) / 1.6) * Math.PI) : 0)
  }, 0)

  const scale = (0.94 + 0.06 * enter) * (1 - 0.05 * recede) * (1 - 0.06 * exit)
  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: view.x,
          top: view.y,
          width: view.w,
          height: view.h,
          borderRadius: view.r,
          overflow: "hidden",
          backgroundColor: "#ffffff",
          opacity: enter * (1 - exit),
          transform: `translateY(${(1 - enter) * 70 - exit * 30}px) scale(${scale})`,
          filter: recede > 0 ? `blur(${recede * 9}px) brightness(${1 - 0.58 * recede})` : undefined,
          boxShadow: "0 50px 120px rgba(0,0,0,0.62), 0 12px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.10)"
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: FOOTAGE.w,
            height: FOOTAGE.h,
            transformOrigin: "0 0",
            transform: `translate(${cam.tx}px, ${cam.ty}px) scale(${cam.s})`
          }}
        >
          <Footage />
          {SPOTS.map((spot, i) => {
            const on = prog(frame, spot.from, spot.from + 0.35, ease.out) * (1 - prog(frame, spot.to, spot.to + 0.3, ease.inOut))
            if (on === 0) return null
            const grow = (1 - on) * 10
            return (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: spot.x - grow,
                  top: spot.y - grow,
                  width: spot.w + grow * 2,
                  height: spot.h + grow * 2,
                  borderRadius: (spot.r ?? 8) + grow,
                  boxShadow: `0 0 0 ${(2.5 * k) / cam.s}px ${color.accentText}, 0 0 0 4000px rgba(8,8,10,${0.5 * on})`,
                  opacity: Math.min(1, on * 1.5)
                }}
              />
            )
          })}
        </div>

        {clicks.map((click, i) => {
          const ring = prog(frame, click.at, click.at + 0.5, ease.out)
          if (ring === 0 || ring === 1) return null
          const c = toWindow(click.x, click.y)
          const radius = (10 + ring * 34) * k
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: c.x - radius,
                top: c.y - radius,
                width: radius * 2,
                height: radius * 2,
                borderRadius: 999,
                backgroundColor: `rgba(255,106,43,${0.28 * (1 - ring)})`,
                border: `${2.5 * k}px solid rgba(255,106,43,${0.9 * (1 - ring)})`
              }}
            />
          )
        })}
        <Pointer x={p.x} y={p.y} press={press} opacity={pointerOpacity} scale={k * (0.82 + 0.18 * Math.min(cam.s, 2))} />
      </div>
    </AbsoluteFill>
  )
}

import { Composition, registerRoot } from "remotion"
import { H, TutorialHorizontal } from "./Horizontal"
import { DURATION_S, FPS } from "./theme"
import { TutorialVertical, V } from "./Vertical"

const durationInFrames = Math.ceil(DURATION_S * FPS)

/** The two videos Remotion can render. Both are the same 44 seconds; only the canvas and framing differ. */
const Root = () => (
  <>
    <Composition id="TutorialHorizontal" component={TutorialHorizontal} width={H.width} height={H.height} fps={FPS} durationInFrames={durationInFrames} />
    <Composition id="TutorialVertical" component={TutorialVertical} width={V.width} height={V.height} fps={FPS} durationInFrames={durationInFrames} />
  </>
)

registerRoot(Root)

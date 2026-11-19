/**
 * The script added to classes.oregonstate.edu. It puts a "Notify me" control
 * (`NotifyControl.tsx`) into the foot of every class-details panel, next to
 * the page's own ADD TO CART button, and keeps it there while the page
 * redraws itself. What the page's HTML looks like is in `detailsPanel.ts`.
 *
 * Nothing private is ever drawn into the page: signing in happens in a frame
 * showing a page of the extension (`entrypoints/signin`).
 */
import "@/assets/tailwind.css"
import { Option } from "effect"
import { createRoot, type Root } from "react-dom/client"
import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { createShadowRootUi, type ShadowRootContentScriptUi } from "wxt/utils/content-script-ui/shadow-root"
import { defineContentScript } from "wxt/utils/define-content-script"
import type { Crn } from "@/lib/domain"
import { SUPPORTED_TERM } from "@/lib/term"
import { findButtonBar, findDetailsPanels, findPanelStack, readCrn, readTerm } from "./detailsPanel"
import { NotifyControl, OtherTermNote } from "./NotifyControl"

export default defineContentScript({
  matches: ["https://classes.oregonstate.edu/*"],
  // "ui": do not inject the stylesheet into the page. WXT's shadow-root helper
  // loads it into our own UI instead, so the page's styles stay untouched.
  cssInjectionMode: "ui",

  // `ctx` is "invalidated" when the extension is updated, reloaded or removed
  // while the page stays open. Everything below stops and cleans up then.
  main(ctx) {
    const stack = findPanelStack(document)
    if (stack === null) {
      return // Not the class search itself (an error page, for example).
    }

    // One control per details panel, made the first time the panel is seen.
    // (A promise, because making one loads the stylesheet.)
    const controls = new Map<Element, Promise<Control>>()

    /** Bring our controls in line with the panels that are on the page now. */
    const sync = () => {
      for (const panel of findDetailsPanels(stack)) {
        if (!controls.has(panel)) {
          controls.set(panel, createControl(ctx, panel))
        }
      }
      for (const [panel, pendingControl] of controls) {
        void pendingControl.then((control) => place(ctx, panel, control))
        if (!panel.isConnected) {
          controls.delete(panel) // `place` has just been told to take it off the page.
        }
      }
    }

    // The page never reloads; it adds, redraws and removes panels. `sync`
    // changes nothing when everything is in place, so it simply runs after
    // every change to the elements inside the stack.
    const observer = new MutationObserver(sync)
    observer.observe(stack, { childList: true, subtree: true })
    ctx.onInvalidated(() => observer.disconnect())

    sync()
  }
})

/** What `onMount` below hands back: the React root, and what it was mounted for. */
interface Mounted {
  readonly root: Root
  readonly bar: Element | null
  readonly crn: Crn | undefined
  readonly term: string | undefined
}

type Control = ShadowRootContentScriptUi<Mounted>

/**
 * Make the control for one details panel. It is not on the page yet: `place`
 * mounts it, and mounts it again each time the page rebuilds the panel.
 */
function createControl(ctx: ContentScriptContext, panel: Element): Promise<Control> {
  // The shadow root keeps the page's styles out of our UI and ours out of the
  // page. WXT also removes the control when `ctx` is invalidated.
  return createShadowRootUi<Mounted>(ctx, {
    name: "getthedamclass-notify",
    position: "inline",
    // Placed just before the page's button bar, not inside it. Two things on
    // the real page make "inside" a bad idea:
    //   - The page's stylesheet sizes ADD TO CART by how many children the bar
    //     has; an extra first child makes it half the bar wide.
    //   - The page keeps Tab inside a panel by sending it from the panel's
    //     last button back to the first. Anything after ADD TO CART can never
    //     be reached with the keyboard. Before it, we are part of the loop.
    anchor: () => findButtonBar(panel),
    append: "before",
    // The element that carries the shadow root is an ordinary block. (WXT
    // resets it with `all: initial !important`, hence the `!important` here.)
    css: ":host { display: block !important; }",
    // Keys pressed on our button stay in our UI: Escape closes our sign-in
    // popover without the page's own keyboard handlers acting on it too.
    isolateEvents: true,
    onMount(container, _shadow, host) {
      const crn = Option.getOrUndefined(readCrn(panel))
      const term = Option.getOrUndefined(readTerm(panel))
      const root = createRoot(container)
      // (`place` only mounts a control when the panel shows a CRN.)
      if (crn !== undefined) {
        // A panel that does not say which term it shows gets the button: the
        // page may have changed its markup, and a working button that the
        // server can still refuse beats no button at all.
        const alertsWork = term === undefined || term === SUPPORTED_TERM.code
        root.render(alertsWork ? <NotifyControl crn={crn} /> : <OtherTermNote />)
      }
      return { root, bar: host.nextElementSibling, crn, term }
    },
    onRemove(mounted) {
      mounted?.root.unmount()
    }
  })
}

/**
 * Make sure a panel's control sits in front of the panel's current button bar
 * and belongs to the section the panel shows now. Safe to call at any time
 * and any number of times.
 */
function place(ctx: ContentScriptContext, panel: Element, control: Control): void {
  const bar = findButtonBar(panel)
  const crn = Option.getOrUndefined(readCrn(panel))
  const term = Option.getOrUndefined(readTerm(panel))
  // No bar means the page offers no actions for this section (a past term).
  // No CRN means the panel shows a whole class rather than one section, and
  // an alert needs a section. In both cases we show nothing rather than a
  // button that cannot work; picking a section redraws the panel and the
  // control appears.
  const wanted = ctx.isValid && panel.isConnected && bar !== null && crn !== undefined

  const mounted = control.mounted
  if (wanted && mounted !== undefined && mounted.bar === bar && mounted.crn === crn && mounted.term === term) {
    return // Already in place.
  }
  // Mounting again from scratch (rather than moving the old one) also drops
  // whatever the old control was in the middle of. A sign-in opened for one
  // section can therefore never end in an alert for another.
  if (mounted !== undefined) {
    control.remove()
  }
  if (wanted) {
    control.mount()
  }
}

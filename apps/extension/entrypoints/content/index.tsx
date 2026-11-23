import "@/assets/tailwind.css"
import type { Crn, Term } from "@getthedamclass/shared/domain"
import { Option } from "effect"
import { createRoot, type Root } from "react-dom/client"
import type { ContentScriptContext } from "wxt/utils/content-script-context"
import { createShadowRootUi, type ShadowRootContentScriptUi } from "wxt/utils/content-script-ui/shadow-root"
import { defineContentScript } from "wxt/utils/define-content-script"
import { findButtonBar, findDetailsPanels, findPanelStack, readCrn, readTerm } from "./detailsPanel"
import { NotifyControl } from "./NotifyControl"

export default defineContentScript({
  matches: ["https://classes.oregonstate.edu/*"],
  cssInjectionMode: "ui",

  main(ctx) {
    const stack = findPanelStack(document)
    if (stack === null) {
      return
    }

    const controls = new Map<Element, Promise<Control>>()

    const sync = () => {
      for (const panel of findDetailsPanels(stack)) {
        if (!controls.has(panel)) {
          controls.set(panel, createControl(ctx, panel))
        }
      }
      for (const [panel, pendingControl] of controls) {
        void pendingControl.then((control) => place(ctx, panel, control))
        if (!panel.isConnected) {
          controls.delete(panel)
        }
      }
    }

    const observer = new MutationObserver(sync)
    observer.observe(stack, { childList: true, subtree: true })
    ctx.onInvalidated(() => observer.disconnect())

    sync()
  }
})

interface Mounted {
  readonly root: Root
  readonly bar: Element | null
  readonly crn: Crn | undefined
  readonly term: Term | undefined
}

type Control = ShadowRootContentScriptUi<Mounted>

function createControl(ctx: ContentScriptContext, panel: Element): Promise<Control> {
  return createShadowRootUi<Mounted>(ctx, {
    name: "getthedamclass-notify",
    position: "inline",
    // Before the page's button bar, not inside it: the page sizes ADD TO CART by the bar's child count,
    // and its Tab loop never reaches anything after ADD TO CART.
    anchor: () => findButtonBar(panel),
    append: "before",
    // WXT resets the host with `all: initial !important`, hence the `!important`.
    css: ":host { display: block !important; }",
    isolateEvents: true,
    onMount(container, _shadow, host) {
      const crn = Option.getOrUndefined(readCrn(panel))
      const term = Option.getOrUndefined(readTerm(panel))
      const root = createRoot(container)
      if (crn !== undefined && term !== undefined) {
        root.render(<NotifyControl classId={{ term, crn }} />)
      }
      return { root, bar: host.nextElementSibling, crn, term }
    },
    onRemove(mounted) {
      mounted?.root.unmount()
    }
  })
}

function place(ctx: ContentScriptContext, panel: Element, control: Control): void {
  const bar = findButtonBar(panel)
  const crn = Option.getOrUndefined(readCrn(panel))
  const term = Option.getOrUndefined(readTerm(panel))
  // No bar: a past term. No CRN: a whole class, not a section. No term: the CRN alone could be
  // another term's class.
  const wanted = ctx.isValid && panel.isConnected && bar !== null && crn !== undefined && term !== undefined

  const mounted = control.mounted
  if (wanted && mounted !== undefined && mounted.bar === bar && mounted.crn === crn && mounted.term === term) {
    return
  }
  // Mounting from scratch drops whatever the old control was doing, so a sign-in opened for one
  // section can never end in an alert for another.
  if (mounted !== undefined) {
    control.remove()
  }
  if (wanted) {
    control.mount()
  }
}

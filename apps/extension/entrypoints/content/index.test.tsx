// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { ContentScriptContext } from "wxt/utils/content-script-context"
import { API_BASE_URL } from "@/lib/Api"
import { findButtonBar, findDetailsPanels, findPanelStack } from "./detailsPanel"
import springPage from "./fixtures/spring-2027-section.html?raw"
import winterPage from "./fixtures/winter-2027-section.html?raw"
import contentScript from "./index"

// These tests start the content script on a fixture page and then change the
// page the way the real one does. `NotifyControl.test.tsx` covers what the
// control itself does.

// The fixtures are Winter and Spring 2027 sections. Pin the supported term to
// Winter here, so these tests keep passing when `lib/term.ts` moves on.
vi.mock("@/lib/term", () => ({ SUPPORTED_TERM: { code: "202702", label: "Winter 2027" } }))

const HOST = "getthedamclass-notify"

let ctx: ContentScriptContext
/** Every request the script sent to the backend (answered here with a plain 200). */
let backendRequests: Array<{ readonly path: string; readonly body: unknown }>

/** Load a fixture, start the script, and wait for the first control. */
async function startOn(pageHtml: string) {
  document.body.innerHTML = pageHtml
  ctx = new ContentScriptContext("content", { matches: [], cssInjectionMode: "ui" })
  await contentScript.main(ctx)
  await expect.poll(hostCount).toBe(1)
  return findDetailsPanels(findPanelStack(document)!)[0]!
}

const hostCount = () => document.querySelectorAll(HOST).length

/** What our control shows in a panel, read through its shadow root. */
const shadow = (panel: Element) => panel.querySelector(HOST)?.shadowRoot
const button = (panel: Element) => shadow(panel)?.querySelector("button") ?? null
const buttonText = (panel: Element) => button(panel)?.textContent
const dialog = (panel: Element) => shadow(panel)?.querySelector("[role=dialog]") ?? null
const noteText = (panel: Element) => shadow(panel)?.querySelector("p")?.textContent

/** Let the observer and React catch up, before checking that something did NOT happen. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

interface Shown {
  /** The section line, or `null` for the overview of a class. */
  readonly section: string | null
  /** The term of the section's row in "All Sections", or `null` for no row. Default: Winter 2027. */
  readonly term?: string | null
  readonly foot: boolean
}

/** The section's row in "All Sections", which says which term it belongs to. */
const sectionRowHtml = (term: string) => `<a class="course-section course-section--viewing" data-srcdb="${term}"></a>`

/** The head, body and foot of a details panel, the way the page builds them. */
const contentHtml = ({ section, term = "202702", foot }: Shown) => `
  <div class="panel__head"><h2>CS 161</h2></div>
  <div class="panel__body">
    <div class="dtl-course-code">CS 161</div>
    ${section === null ? "" : `<div class="dtl-section">${section}</div>`}
    ${term === null ? "" : sectionRowHtml(term)}
  </div>
  ${
  foot
    ? `<div class="panel__foot"><div class="cart-controls button-bar button-bar--right-align"><button class="btn">ADD TO CART</button></div></div>`
    : ""
}`

/** Redraw a details panel the way the page does: throw away its head, body and foot, and build new ones. */
function redraw(panel: Element, shown: Shown) {
  panel.querySelector(".panel__content")!.innerHTML = contentHtml(shown)
}

beforeEach(() => {
  fakeBrowser.reset()
  backendRequests = []
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.origin === API_BASE_URL) {
      backendRequests.push({ path: url.pathname, body: JSON.parse(String(init?.body)) })
      return Promise.resolve(new Response(JSON.stringify({ message: "ok" })))
    }
    // The script loads its stylesheet from the extension; give it an empty one.
    return Promise.resolve(new Response(""))
  })
})
afterEach(() => {
  ctx.notifyInvalidated()
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

describe("content script", () => {
  it("puts one control just before the details panel's button bar", async () => {
    const panel = await startOn(winterPage)
    expect(panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))
    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    // The page's own bar is left exactly as it was.
    expect(findButtonBar(panel)!.children).toHaveLength(1)
    expect(backendRequests).toEqual([])
  })

  it("adds the control again, once, each time the page redraws the panel", async () => {
    const panel = await startOn(winterPage)

    redraw(panel, { section: "Section 400, CRN 51625", foot: true })
    expect(hostCount()).toBe(0) // The page threw ours away with the old foot.
    await expect.poll(() => panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))

    redraw(panel, { section: "Section 401, CRN 53476", foot: true })
    await expect.poll(() => panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))
    expect(hostCount()).toBe(1)
  })

  it("adds the control again when the page replaces more of the panel than its head, body and foot", async () => {
    const panel = await startOn(winterPage)

    // Not what the page does today, but nothing here should depend on which
    // element inside the panel the page chooses to rebuild.
    panel.innerHTML = `<div class="panel__content">${contentHtml({ section: "Section 400, CRN 51625", foot: true })}</div>`
    expect(hostCount()).toBe(0)

    await expect.poll(() => panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))
    expect(hostCount()).toBe(1)
  })

  it("shows nothing when the panel has no button bar or no CRN, and comes back when it has both", async () => {
    const panel = await startOn(winterPage)

    redraw(panel, { section: "Section 400, CRN 70742", term: "202700", foot: false }) // a past term
    await settled()
    expect(hostCount()).toBe(0)

    redraw(panel, { section: null, term: null, foot: true }) // a class overview: no section chosen
    await settled()
    expect(hostCount()).toBe(0)

    redraw(panel, { section: "Section 400, CRN 33940", foot: true })
    await expect.poll(hostCount).toBe(1)
  })

  it("gives every details panel its own control when the page stacks a second one", async () => {
    const first = await startOn(winterPage)
    const second = first.cloneNode(true) as Element
    second.querySelector(HOST)?.remove()
    second.querySelector(".dtl-section")!.textContent = "Section 010, CRN 12345"

    first.after(second)

    await expect.poll(hostCount).toBe(2)
    expect(first.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(first))
    expect(second.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(second))
  })

  it("mounts a fresh control when the section changes but the page keeps the button bar", async () => {
    const panel = await startOn(winterPage)
    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    const buttonBefore = button(panel)

    // Not what the page does today (it always rebuilds the foot too), but if
    // it ever keeps the bar, the control must not carry over to the new section.
    panel.querySelector(".dtl-section")!.textContent = "Section 400, CRN 51625"

    await expect.poll(() => button(panel) !== null && button(panel) !== buttonBefore).toBe(true)
    expect(hostCount()).toBe(1)
    expect(buttonText(panel)).toBe("Notify me")
  })

  it("leaves the control alone when the page changes something else in the panel", async () => {
    const panel = await startOn(winterPage)
    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    const buttonBefore = button(panel)

    // The real page adds its "copy link" button to the head a moment after drawing the panel.
    panel.querySelector(".panel__head")!.insertAdjacentHTML("beforeend", `<a class="deep-link" href="#">link</a>`)
    await settled()

    expect(button(panel)).toBe(buttonBefore)
    expect(hostCount()).toBe(1)
  })

  it("removes the control when the panel goes away", async () => {
    const panel = await startOn(winterPage)
    const host = panel.querySelector(HOST)!

    panel.remove() // the user pressed Back

    expect(hostCount()).toBe(0)
    // Not just gone with the panel: taken out and unmounted.
    await expect.poll(() => host.isConnected || host.parentElement !== null).toBe(false)
  })

  it("removes every control and stops watching when the extension context is invalidated", async () => {
    const panel = await startOn(winterPage)

    ctx.notifyInvalidated()
    expect(hostCount()).toBe(0)

    redraw(panel, { section: "Section 400, CRN 51625", foot: true })
    await settled()
    expect(hostCount()).toBe(0)
  })

  it("does nothing on a page that is not the class search", async () => {
    document.body.innerHTML = "<h1>403 Forbidden</h1>"
    ctx = new ContentScriptContext("content", { matches: [], cssInjectionMode: "ui" })
    await contentScript.main(ctx)
    await settled()
    expect(hostCount()).toBe(0)
  })
})

describe("content script, terms", () => {
  it("offers alerts on a section of the term the backend watches", async () => {
    const panel = await startOn(winterPage)
    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    expect(shadow(panel)?.textContent).not.toContain("Seat alerts cover")
  })

  it("shows a note instead of the button on a section of another term", async () => {
    const panel = await startOn(springPage)
    await expect.poll(() => noteText(panel)).toBe("Seat alerts cover Winter 2027 classes only.")
    expect(button(panel)).toBeNull()
    // In the same spot as the button would be.
    expect(panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))
  })

  it("swaps between button and note as the panel moves between terms", async () => {
    const panel = await startOn(winterPage)
    await expect.poll(() => buttonText(panel)).toBe("Notify me")

    redraw(panel, { section: "Section 401, CRN 53476", term: "202703", foot: true })
    await expect.poll(() => noteText(panel)).toBe("Seat alerts cover Winter 2027 classes only.")

    redraw(panel, { section: "Section 400, CRN 33940", term: "202702", foot: true })
    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    expect(hostCount()).toBe(1)
  })

  it("shows nothing while the panel does not say which term it shows, and the button once it does", async () => {
    await fakeBrowser.storage.local.set({ email: "student@oregonstate.edu", pin: "1234" })
    const panel = await startOn(winterPage)

    // The section and ADD TO CART are there; what names the term is not (yet).
    redraw(panel, { section: "Section 400, CRN 33940", term: null, foot: true })
    await settled()
    // No button: a press would send a bare CRN, which the server looks up in
    // its own term, where the same number can be another class.
    expect(hostCount()).toBe(0)
    expect(backendRequests).toEqual([])

    panel.querySelector(".panel__body")!.insertAdjacentHTML("beforeend", sectionRowHtml("202702"))

    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    expect(panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))
    button(panel)!.click()
    await expect.poll(() => buttonText(panel)).toBe("Watching")
    expect(backendRequests.map((request) => request.path)).toEqual(["/sub"])
  })

  it("shows the note once a panel that did not say turns out to be of another term", async () => {
    const panel = await startOn(winterPage)
    redraw(panel, { section: "Section 401, CRN 53476", term: null, foot: true })
    await settled()
    expect(hostCount()).toBe(0)

    // The copy-link the page adds to the head names the term as well.
    panel.querySelector(".panel__head")!.insertAdjacentHTML(
      "beforeend",
      `<a class="deep-link" data-query-string="?details&amp;srcdb=202703&amp;crn=53476" href="#">link</a>`
    )

    await expect.poll(() => noteText(panel)).toBe("Seat alerts cover Winter 2027 classes only.")
    expect(button(panel)).toBeNull()
    expect(backendRequests).toEqual([])
  })
})

describe("content script, signing in from the page", () => {
  const student = { email: "student@oregonstate.edu", pin: "1234" }

  /** Press "Notify me" while signed out, and wait for the sign-in popover. */
  async function pressSignedOut(panel: Element) {
    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    button(panel)!.click()
    await expect.poll(() => dialog(panel)).not.toBeNull()
  }

  /**
   * What the framed sign-in page does once the server has accepted the email
   * and PIN: save them, then tell the page around it (and nothing more).
   */
  async function finishSignIn(frame: Window | null) {
    await fakeBrowser.storage.local.set(student)
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "getthedamclass/signed-in" },
        origin: new URL(fakeBrowser.runtime.getURL("/signin.html")).origin,
        source: frame
      })
    )
  }
  const frameOf = (panel: Element) => dialog(panel)!.querySelector("iframe")!.contentWindow

  it("subscribes to the section the user pressed on once they have signed in", async () => {
    const panel = await startOn(winterPage)
    await pressSignedOut(panel)
    expect(backendRequests).toEqual([])

    await finishSignIn(frameOf(panel))

    await expect.poll(() => buttonText(panel)).toBe("Watching")
    expect(backendRequests).toEqual([{ path: "/sub", body: { crn: "33940", ...student } }])
  })

  it("drops the request when the panel has moved on to another section before the sign-in finishes", async () => {
    const panel = await startOn(winterPage)
    await pressSignedOut(panel) // for CRN 33940
    const frame = frameOf(panel)

    // The sign-in is still on its way when the user picks another section.
    redraw(panel, { section: "Section 010, CRN 12345", foot: true })
    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    await finishSignIn(frame)
    await settled()

    // Nothing was subscribed: not the section left behind, and above all not
    // the one that happens to be on screen now.
    expect(backendRequests).toEqual([])
    expect(buttonText(panel)).toBe("Notify me")
    expect(dialog(panel)).toBeNull()
  })

  it("subscribes to nothing when the user signs in somewhere else while a popover is open", async () => {
    const panel = await startOn(winterPage)
    await pressSignedOut(panel)

    // The toolbar popup, or another tab, saved a sign-in. Nobody used our form.
    await fakeBrowser.storage.local.set(student)
    await settled()

    expect(backendRequests).toEqual([])
    expect(buttonText(panel)).toBe("Notify me")
  })
})

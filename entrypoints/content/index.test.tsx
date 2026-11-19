// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ContentScriptContext } from "wxt/utils/content-script-context"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { findButtonBar, findDetailsPanels, findPanelContent, findPanelStack } from "./detailsPanel"
import pageHtml from "./fixtures/details-panel.html?raw"
import contentScript from "./index"

// These tests start the content script on the fixture page and then change
// the page the way the real one does. They never press the button, so no
// backend is involved; `NotifyControl.test.tsx` covers what a press does.

const HOST = "getthedamclass-notify"

let ctx: ContentScriptContext

/** Load the fixture, start the script, and wait for the first control. */
async function startOnFixture() {
  document.body.innerHTML = pageHtml
  ctx = new ContentScriptContext("content", { matches: [], cssInjectionMode: "ui" })
  await contentScript.main(ctx)
  await expect.poll(hostCount).toBe(1)
  return findDetailsPanels(findPanelStack(document)!)[0]!
}

const hostCount = () => document.querySelectorAll(HOST).length

/** The text of the control's button, read through its shadow root. */
const buttonText = (panel: Element) => panel.querySelector(HOST)?.shadowRoot?.querySelector("button")?.textContent

/**
 * Redraw a details panel the way the page does: throw away the head, body and
 * foot, and build new ones.
 */
function redraw(panel: Element, options: { readonly section: string | null; readonly foot: boolean }) {
  findPanelContent(panel)!.innerHTML = `
    <div class="panel__head"><h2>CS 161</h2></div>
    <div class="panel__body">
      <div class="dtl-course-code">CS 161</div>
      ${options.section === null ? "" : `<div class="dtl-section">${options.section}</div>`}
    </div>
    ${
    options.foot
      ? `<div class="panel__foot"><div class="cart-controls button-bar button-bar--right-align"><button class="btn">ADD TO CART</button></div></div>`
      : ""
  }`
}

beforeEach(() => {
  fakeBrowser.reset()
  // The script loads its stylesheet from the extension; give it an empty one.
  vi.stubGlobal("fetch", () => Promise.resolve(new Response("")))
})
afterEach(() => {
  ctx.notifyInvalidated()
  document.body.innerHTML = ""
  vi.unstubAllGlobals()
})

describe("content script", () => {
  it("puts one control just before the details panel's button bar", async () => {
    const panel = await startOnFixture()
    expect(panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))
    expect(buttonText(panel)).toBe("Notify me")
    // The page's own bar is left exactly as it was.
    expect(findButtonBar(panel)!.children).toHaveLength(1)
  })

  it("adds the control again, once, each time the page redraws the panel", async () => {
    const panel = await startOnFixture()

    redraw(panel, { section: "Section 400, CRN 51625", foot: true })
    expect(hostCount()).toBe(0) // The page threw ours away with the old foot.
    await expect.poll(() => panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))

    redraw(panel, { section: "Section 401, CRN 53476", foot: true })
    await expect.poll(() => panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))
    expect(hostCount()).toBe(1)
  })

  it("shows nothing when the panel has no button bar or no CRN, and comes back when it has both", async () => {
    const panel = await startOnFixture()
    // Let the observer catch up before checking that nothing was added.
    const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

    redraw(panel, { section: "Section 400, CRN 70742", foot: false }) // a past term
    await settled()
    expect(hostCount()).toBe(0)

    redraw(panel, { section: null, foot: true }) // a class overview: no section chosen
    await settled()
    expect(hostCount()).toBe(0)

    redraw(panel, { section: "Section 401, CRN 53476", foot: true })
    await expect.poll(hostCount).toBe(1)
  })

  it("gives every details panel its own control when the page stacks a second one", async () => {
    const first = await startOnFixture()
    const second = first.cloneNode(true) as Element
    second.querySelector(HOST)?.remove()
    second.querySelector(".dtl-section")!.textContent = "Section 010, CRN 12345"

    first.after(second)

    await expect.poll(hostCount).toBe(2)
    expect(first.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(first))
    expect(second.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(second))
  })

  it("mounts a fresh control when the section changes but the page keeps the button bar", async () => {
    const panel = await startOnFixture()
    const hostBefore = panel.querySelector(HOST)!
    const buttonBefore = hostBefore.shadowRoot!.querySelector("button")

    // Not what the page does today (it always rebuilds the foot too), but if
    // it ever keeps the bar, the control must not carry state across sections.
    const newBody = document.createElement("div")
    newBody.className = "panel__body"
    newBody.innerHTML = `<div class="dtl-section">Section 400, CRN 51625</div>`
    panel.querySelector(".panel__body")!.replaceWith(newBody)

    const buttonNow = () => panel.querySelector(HOST)?.shadowRoot?.querySelector("button") ?? null
    await expect.poll(() => buttonNow() !== null && buttonNow() !== buttonBefore).toBe(true)
    expect(hostCount()).toBe(1)
    expect(buttonText(panel)).toBe("Notify me")
  })

  it("removes the control when the panel goes away", async () => {
    const panel = await startOnFixture()
    const host = panel.querySelector(HOST)!

    panel.remove() // the user pressed Back

    expect(hostCount()).toBe(0)
    // Not just gone with the panel: taken out and unmounted.
    await expect.poll(() => host.isConnected || host.parentElement !== null).toBe(false)
  })

  it("removes every control and stops watching when the extension context is invalidated", async () => {
    const panel = await startOnFixture()

    ctx.notifyInvalidated()
    expect(hostCount()).toBe(0)

    redraw(panel, { section: "Section 400, CRN 51625", foot: true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(hostCount()).toBe(0)
  })

  it("does nothing on a page that is not the class search", async () => {
    document.body.innerHTML = "<h1>403 Forbidden</h1>"
    ctx = new ContentScriptContext("content", { matches: [], cssInjectionMode: "ui" })
    await contentScript.main(ctx)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(hostCount()).toBe(0)
  })
})

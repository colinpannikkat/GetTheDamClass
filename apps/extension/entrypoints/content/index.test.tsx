// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { ContentScriptContext } from "wxt/utils/content-script-context"
import { API_BASE_URL } from "@/lib/Api"
import { findButtonBar, findDetailsPanels, findPanelStack } from "./detailsPanel"
import springPage from "./fixtures/spring-2027-section.html?raw"
import winterPage from "./fixtures/winter-2027-section.html?raw"
import contentScript from "./index"

const HOST = "getthedamclass-notify"

let ctx: ContentScriptContext
let serverRequests: Array<{
  readonly method: string
  readonly path: string
  readonly authorization: string | null
  readonly body: unknown
}>
let subscribeReply: (body: { readonly term: string; readonly crn: string }) => Response

async function startOn(pageHtml: string) {
  document.body.innerHTML = pageHtml
  ctx = new ContentScriptContext("content", { matches: [], cssInjectionMode: "ui" })
  await contentScript.main(ctx)
  await expect.poll(hostCount).toBe(1)
  return findDetailsPanels(findPanelStack(document)!)[0]!
}

const hostCount = () => document.querySelectorAll(HOST).length

const shadow = (panel: Element) => panel.querySelector(HOST)?.shadowRoot
const button = (panel: Element) => shadow(panel)?.querySelector("button") ?? null
const buttonText = (panel: Element) => button(panel)?.textContent
const dialog = (panel: Element) => shadow(panel)?.querySelector("[role=dialog]") ?? null
const messageText = (panel: Element) => shadow(panel)?.querySelector("[role=alert] p")?.textContent

const settled = () => new Promise((resolve) => setTimeout(resolve, 20))

interface Shown {
  readonly section: string | null
  readonly term?: string | null
  readonly foot: boolean
}

const sectionRowHtml = (term: string) => `<a class="course-section course-section--viewing" data-srcdb="${term}"></a>`

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

function redraw(panel: Element, shown: Shown) {
  panel.querySelector(".panel__content")!.innerHTML = contentHtml(shown)
}

const student = { email: "student@oregonstate.edu", token: "student-token" }

beforeEach(() => {
  fakeBrowser.reset()
  serverRequests = []
  subscribeReply = (body) => Response.json({ ...body, title: "INTRO TO COMPUTER SCIENCE I" })
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const url = new URL(request.url)
    if (url.origin !== API_BASE_URL) {
      // The script loads its stylesheet from the extension; give it an empty one.
      return new Response("")
    }
    const text = await request.text()
    const body = text === "" ? undefined : JSON.parse(text)
    serverRequests.push({
      method: request.method,
      path: url.pathname,
      authorization: request.headers.get("authorization"),
      body
    })
    return request.method === "POST" && url.pathname === "/alerts" ? subscribeReply(body) : new Response(null, { status: 204 })
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
    expect(findButtonBar(panel)!.children).toHaveLength(1)
    expect(serverRequests).toEqual([])
  })

  it("adds the control again, once, each time the page redraws the panel", async () => {
    const panel = await startOn(winterPage)

    redraw(panel, { section: "Section 400, CRN 51625", foot: true })
    expect(hostCount()).toBe(0)
    await expect.poll(() => panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))

    redraw(panel, { section: "Section 401, CRN 53476", foot: true })
    await expect.poll(() => panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))
    expect(hostCount()).toBe(1)
  })

  it("adds the control again when the page replaces more of the panel than its head, body and foot", async () => {
    const panel = await startOn(winterPage)

    panel.innerHTML = `<div class="panel__content">${contentHtml({ section: "Section 400, CRN 51625", foot: true })}</div>`
    expect(hostCount()).toBe(0)

    await expect.poll(() => panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))
    expect(hostCount()).toBe(1)
  })

  it("shows nothing when the panel has no button bar or no CRN, and comes back when it has both", async () => {
    const panel = await startOn(winterPage)

    redraw(panel, { section: "Section 400, CRN 70742", term: "202700", foot: false })
    await settled()
    expect(hostCount()).toBe(0)

    redraw(panel, { section: null, term: null, foot: true })
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

    panel.querySelector(".dtl-section")!.textContent = "Section 400, CRN 51625"

    await expect.poll(() => button(panel) !== null && button(panel) !== buttonBefore).toBe(true)
    expect(hostCount()).toBe(1)
    expect(buttonText(panel)).toBe("Notify me")
  })

  it("leaves the control alone when the page changes something else in the panel", async () => {
    const panel = await startOn(winterPage)
    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    const buttonBefore = button(panel)

    panel.querySelector(".panel__head")!.insertAdjacentHTML("beforeend", `<a class="deep-link" href="#">link</a>`)
    await settled()

    expect(button(panel)).toBe(buttonBefore)
    expect(hostCount()).toBe(1)
  })

  it("removes the control when the panel goes away", async () => {
    const panel = await startOn(winterPage)
    const host = panel.querySelector(HOST)!

    panel.remove()

    expect(hostCount()).toBe(0)
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
  async function subscribeOn(panel: Element) {
    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    button(panel)!.click()
    await expect.poll(() => buttonText(panel)).toBe("Watching")
  }

  it("offers alerts on a section of any term, and sends the section's term with its CRN", async () => {
    await fakeBrowser.storage.local.set(student)
    const panel = await startOn(springPage)

    await subscribeOn(panel)

    expect(serverRequests).toEqual([{
      method: "POST",
      path: "/alerts",
      authorization: "Bearer student-token",
      body: { term: "202703", crn: "53476" }
    }])
  })

  it("shows the server's refusal as it is, and keeps the button", async () => {
    const sentence = "Seat alerts for Spring 2027 start when registration opens."
    subscribeReply = () => Response.json({ _tag: "TermNotOpen", message: sentence }, { status: 409 })
    await fakeBrowser.storage.local.set(student)
    const panel = await startOn(springPage)
    await expect.poll(() => buttonText(panel)).toBe("Notify me")

    button(panel)!.click()

    await expect.poll(() => messageText(panel)).toBe(sentence)
    expect(buttonText(panel)).toBe("Notify me")
  })

  it("treats the same CRN in another term as another class", async () => {
    await fakeBrowser.storage.local.set(student)
    const panel = await startOn(winterPage)
    await subscribeOn(panel)

    redraw(panel, { section: "Section 400, CRN 33940", term: "202703", foot: true })

    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    await subscribeOn(panel)
    expect(serverRequests.map((request) => request.body)).toEqual([
      { term: "202702", crn: "33940" },
      { term: "202703", crn: "33940" }
    ])
  })

  it("shows nothing while the panel does not say which term it shows, and the button once it does", async () => {
    await fakeBrowser.storage.local.set(student)
    const panel = await startOn(winterPage)

    redraw(panel, { section: "Section 400, CRN 33940", term: null, foot: true })
    await settled()
    expect(hostCount()).toBe(0)
    expect(serverRequests).toEqual([])

    panel.querySelector(".panel__body")!.insertAdjacentHTML("beforeend", sectionRowHtml("202702"))

    await expect.poll(() => panel.querySelector(HOST)?.nextElementSibling).toBe(findButtonBar(panel))
    await subscribeOn(panel)
    expect(serverRequests.map((request) => request.body)).toEqual([{ term: "202702", crn: "33940" }])
  })

  it("takes the term from the copy-link the page adds to the head, when that is all there is", async () => {
    await fakeBrowser.storage.local.set(student)
    const panel = await startOn(winterPage)
    redraw(panel, { section: "Section 401, CRN 53476", term: null, foot: true })
    await settled()
    expect(hostCount()).toBe(0)

    panel.querySelector(".panel__head")!.insertAdjacentHTML(
      "beforeend",
      `<a class="deep-link" data-query-string="?details&amp;srcdb=202703&amp;crn=53476" href="#">link</a>`
    )

    await subscribeOn(panel)
    expect(serverRequests.map((request) => request.body)).toEqual([{ term: "202703", crn: "53476" }])
  })
})

describe("content script, signing in from the page", () => {
  async function pressSignedOut(panel: Element) {
    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    button(panel)!.click()
    await expect.poll(() => dialog(panel)).not.toBeNull()
  }

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
    expect(serverRequests).toEqual([])

    await finishSignIn(frameOf(panel))

    await expect.poll(() => buttonText(panel)).toBe("Watching")
    expect(serverRequests).toEqual([{
      method: "POST",
      path: "/alerts",
      authorization: "Bearer student-token",
      body: { term: "202702", crn: "33940" }
    }])
  })

  it("drops the request when the panel has moved on to another section before the sign-in finishes", async () => {
    const panel = await startOn(winterPage)
    await pressSignedOut(panel)
    const frame = frameOf(panel)

    redraw(panel, { section: "Section 010, CRN 12345", foot: true })
    await expect.poll(() => buttonText(panel)).toBe("Notify me")
    await finishSignIn(frame)
    await settled()

    expect(serverRequests).toEqual([])
    expect(buttonText(panel)).toBe("Notify me")
    expect(dialog(panel)).toBeNull()
  })

  it("subscribes to nothing when the user signs in somewhere else while a popover is open", async () => {
    const panel = await startOn(winterPage)
    await pressSignedOut(panel)

    await fakeBrowser.storage.local.set(student)
    await settled()

    expect(serverRequests).toEqual([])
    expect(buttonText(panel)).toBe("Notify me")
  })
})

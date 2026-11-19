// @vitest-environment happy-dom
import { Option } from "effect"
import { beforeEach, describe, expect, it } from "vitest"
import { findButtonBar, findDetailsPanels, findPanelContent, findPanelStack, readCrn } from "./detailsPanel"
// `?raw` imports the file's text. It is a trimmed copy of the real page.
import pageHtml from "./fixtures/details-panel.html?raw"

/** Put the fixture on the page and return its one details panel. */
function loadPage(): Element {
  document.body.innerHTML = pageHtml
  const [panel] = findDetailsPanels(findPanelStack(document)!)
  return panel!
}

beforeEach(() => {
  document.body.innerHTML = ""
})

describe("findPanelStack", () => {
  it("finds the element that holds the panels", () => {
    loadPage()
    expect(findPanelStack(document)?.tagName).toBe("MAIN")
  })

  it("is null on a page that is not the class search", () => {
    document.body.innerHTML = "<h1>403 Forbidden</h1>"
    expect(findPanelStack(document)).toBeNull()
  })
})

describe("findDetailsPanels", () => {
  it("finds the details panel and skips the search and results panels", () => {
    loadPage()
    const panels = findDetailsPanels(findPanelStack(document)!)
    expect(panels.map((panel) => panel.getAttribute("data-panel-id"))).toEqual(["2"])
  })

  it("finds every details panel when the page stacks a second one", () => {
    const first = loadPage()
    const second = first.cloneNode(true) as Element
    second.setAttribute("data-panel-id", "3")
    first.after(second)
    expect(findDetailsPanels(findPanelStack(document)!)).toEqual([first, second])
  })
})

describe("findButtonBar", () => {
  it("finds the bar that holds ADD TO CART", () => {
    const bar = findButtonBar(loadPage())
    expect(bar?.className).toBe("cart-controls button-bar button-bar--right-align")
    expect(bar?.textContent).toBe("ADD TO CART")
  })

  it("is null when the panel has no foot (a past term)", () => {
    const panel = loadPage()
    panel.querySelector(".panel__foot")!.remove()
    expect(findButtonBar(panel)).toBeNull()
  })

  it("ignores a button bar that is not in the panel's foot (a form inside the panel)", () => {
    const panel = loadPage()
    panel.querySelector(".panel__foot")!.remove()
    panel.querySelector(".panel__body")!.insertAdjacentHTML(
      "beforeend",
      `<form><div class="button-bar button-bar--right-align"><button class="btn">OK</button></div></form>`
    )
    expect(findButtonBar(panel)).toBeNull()
  })
})

describe("findPanelContent", () => {
  it("finds the element whose children the page replaces", () => {
    const panel = loadPage()
    const content = findPanelContent(panel)
    expect(content?.parentElement).toBe(panel)
    expect(Array.from(content!.children, (child) => child.className)).toEqual([
      "panel__head",
      "panel__body",
      "panel__foot"
    ])
  })
})

describe("readCrn", () => {
  it("reads the CRN of the section shown", () => {
    expect(readCrn(loadPage())).toEqual(Option.some("53476"))
  })

  it("is none on the overview of a class, which names no section", () => {
    const panel = loadPage()
    // The real overview has the course code but no `.dtl-section` at all.
    panel.querySelector(".dtl-section")!.remove()
    expect(readCrn(panel)).toEqual(Option.none())
  })

  it("is none when the section line has no CRN in it", () => {
    const panel = loadPage()
    panel.querySelector(".dtl-section")!.textContent = "Section 401"
    expect(readCrn(panel)).toEqual(Option.none())
  })

  it("follows the panel when it changes to another section", () => {
    const panel = loadPage()
    expect(readCrn(panel)).toEqual(Option.some("53476"))
    // The page rebuilds the body for the section the user picked.
    panel.querySelector(".dtl-section")!.textContent = "Section 400, CRN 51625"
    expect(readCrn(panel)).toEqual(Option.some("51625"))
  })

  it("reads each panel's own CRN when two details panels are open", () => {
    const first = loadPage()
    const second = first.cloneNode(true) as Element
    second.querySelector(".dtl-section")!.textContent = "Section 010, CRN 12345"
    first.after(second)
    expect(readCrn(first)).toEqual(Option.some("53476"))
    expect(readCrn(second)).toEqual(Option.some("12345"))
  })
})

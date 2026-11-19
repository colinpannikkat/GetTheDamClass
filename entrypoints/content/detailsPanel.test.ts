// @vitest-environment happy-dom
import { Option } from "effect"
import { beforeEach, describe, expect, it } from "vitest"
import { findButtonBar, findDetailsPanels, findPanelStack, readCrn, readTerm } from "./detailsPanel"
// `?raw` imports the file's text. Each is a trimmed copy of the real page,
// showing the same class in two terms.
import springPage from "./fixtures/spring-2027-section.html?raw"
import winterPage from "./fixtures/winter-2027-section.html?raw"

/** Put a fixture on the page and return its one details panel. */
function loadPage(pageHtml: string = winterPage): Element {
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

describe("readCrn", () => {
  it("reads the CRN of the section shown", () => {
    expect(readCrn(loadPage(winterPage))).toEqual(Option.some("33940"))
    expect(readCrn(loadPage(springPage))).toEqual(Option.some("53476"))
  })

  it("is none on the overview of a class, which names no section", () => {
    const panel = loadPage()
    // The real overview has the course code but no `.dtl-section` at all.
    panel.querySelector(".dtl-section")!.remove()
    expect(readCrn(panel)).toEqual(Option.none())
  })

  it("is none when the section line has no CRN in it", () => {
    const panel = loadPage()
    panel.querySelector(".dtl-section")!.textContent = "Section 400"
    expect(readCrn(panel)).toEqual(Option.none())
  })

  it("follows the panel when it changes to another section", () => {
    const panel = loadPage()
    expect(readCrn(panel)).toEqual(Option.some("33940"))
    // The page rebuilds the body for the section the user picked.
    panel.querySelector(".dtl-section")!.textContent = "Section 400, CRN 51625"
    expect(readCrn(panel)).toEqual(Option.some("51625"))
  })

  it("reads each panel's own CRN when two details panels are open", () => {
    const first = loadPage()
    const second = first.cloneNode(true) as Element
    second.querySelector(".dtl-section")!.textContent = "Section 010, CRN 12345"
    first.after(second)
    expect(readCrn(first)).toEqual(Option.some("33940"))
    expect(readCrn(second)).toEqual(Option.some("12345"))
  })
})

describe("readTerm", () => {
  it("reads the term of the section shown", () => {
    expect(readTerm(loadPage(winterPage))).toEqual(Option.some("202702"))
    expect(readTerm(loadPage(springPage))).toEqual(Option.some("202703"))
  })

  it("reads it from the row of the section on screen, not from another section's row", () => {
    const panel = loadPage(springPage)
    // The Spring class has two sections; give the other one a different term.
    panel.querySelector(".course-section:not(.course-section--viewing)")!.setAttribute("data-srcdb", "209901")
    expect(readTerm(panel)).toEqual(Option.some("202703"))
  })

  it("is none when the panel does not say", () => {
    const panel = loadPage()
    panel.querySelector(".section--all_sections")!.remove()
    expect(readTerm(panel)).toEqual(Option.none())
  })
})

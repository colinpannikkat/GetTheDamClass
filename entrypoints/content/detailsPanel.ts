/**
 * Finding our way around the class search page (classes.oregonstate.edu).
 *
 * Everything the content script knows about the page's HTML is in this file,
 * so when the university changes its markup this is the place to fix. The
 * functions only read; the files in `fixtures/` are copies of the real page
 * they are tested against (the README says how to refresh them).
 *
 * The page is one long-lived document that slides "panels" in and out:
 *
 *   <main class="panels">                      the stack of panels
 *     <div class="panel panel--kind-root">     search form
 *     <div class="panel panel--kind-results">  search results
 *     <div class="panel panel--kind-details">  one class section
 *       <div class="panel__content">
 *         <div class="panel__head">
 *         <div class="panel__body">
 *           ... <div class="dtl-section">Section 400, CRN 33940</div> ...
 *           ... <a class="course-section course-section--viewing" data-srcdb="202702"> ...
 *         <div class="panel__foot">
 *           <div class="cart-controls button-bar button-bar--right-align">
 *             <button class="btn">ADD TO CART</button>
 *
 * Three things about it that the code depends on:
 *
 * - There can be several details panels at once. Following a link to another
 *   class from inside a details panel adds a second one and slides the first
 *   aside without removing it. So the CRN is always looked up inside one
 *   panel, never in the whole document.
 * - A details panel is kept while the user moves between sections, but the
 *   head, body and foot inside it are thrown away and built again every time.
 * - The foot, and with it the button bar, is only there when the section can
 *   be added to a cart: not for past terms, and not on the overview of a
 *   class with several sections (which has no CRN either).
 */
import { Option } from "effect"
import type { Crn } from "@/lib/domain"
import { parseCrn } from "@/lib/parseCrn"

/** The element all panels are direct children of, or `null` on any other page. */
export const findPanelStack = (root: ParentNode): Element | null => root.querySelector("main.panels")

/** Every class-details panel currently in the stack. */
export const findDetailsPanels = (stack: Element): Array<Element> =>
  Array.from(stack.querySelectorAll(".panel--kind-details"))

/**
 * The bar holding the panel's own buttons (ADD TO CART), or `null` when the
 * panel has none. `.panel__foot` matters: the page also uses `.button-bar`
 * for the buttons of forms and dialogs.
 */
export const findButtonBar = (panel: Element): Element | null => panel.querySelector(".panel__foot .button-bar")

/** The CRN of the section a details panel shows right now, if it shows one. */
export const readCrn = (panel: Element): Option.Option<Crn> =>
  parseCrn(panel.querySelector(".dtl-section")?.textContent ?? "")

/**
 * The code of the term that section belongs to ("202702" is Winter 2027), if
 * the panel says. It is read from the section's own row in the "All Sections"
 * table. That row is drawn together with the rest of the panel; the link in
 * the panel's head that also carries the code is added a moment later.
 */
export const readTerm = (panel: Element): Option.Option<string> =>
  Option.fromNullishOr(panel.querySelector(".course-section--viewing")?.getAttribute("data-srcdb"))

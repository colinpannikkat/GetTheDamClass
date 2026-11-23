/**
 * Everything the content script knows about the page's HTML. The page slides panels in and out:
 *
 *   <main class="panels">                      the stack of panels
 *     <div class="panel panel--kind-root">     search form
 *     <div class="panel panel--kind-results">  search results
 *     <div class="panel panel--kind-details">  one class section
 *       <div class="panel__content">
 *         <div class="panel__head">
 *           ... <a class="deep-link" data-query-string="?details&srcdb=202702&crn=33940"> ...
 *         <div class="panel__body">
 *           ... <div class="dtl-section">Section 400, CRN 33940</div> ...
 *           ... <a class="course-section course-section--viewing" data-srcdb="202702"> ...
 *         <div class="panel__foot">
 *           <div class="cart-controls button-bar button-bar--right-align">
 *             <button class="btn">ADD TO CART</button>
 *
 * There can be several details panels at once, so the CRN is always looked up inside one panel.
 * Head, body and foot are rebuilt on every section change. The foot exists only when the section
 * can be added to a cart.
 */
import { type Crn, Term } from "@getthedamclass/shared/domain"
import { Option, Schema } from "effect"

export const findPanelStack = (root: ParentNode): Element | null => root.querySelector("main.panels")

export const findDetailsPanels = (stack: Element): Array<Element> =>
  Array.from(stack.querySelectorAll(".panel--kind-details"))

// `.panel__foot` matters: the page also uses `.button-bar` for the buttons of forms and dialogs.
export const findButtonBar = (panel: Element): Element | null => panel.querySelector(".panel__foot .button-bar")

export const readCrn = (panel: Element): Option.Option<Crn> =>
  parseCrn(panel.querySelector(".dtl-section")?.textContent ?? "")

export const parseCrn = (text: string): Option.Option<Crn> =>
  Option.fromNullishOr(text.match(/\bCRN\D{0,3}(\d+)/i)?.[1])

// Two places carry it: the section's row in "All Sections", and the head's "copy link", which the
// page adds a moment later.
export const readTerm = (panel: Element): Option.Option<Term> =>
  Option.fromNullishOr(
    panel.querySelector(".course-section--viewing")?.getAttribute("data-srcdb")
      ?? new URLSearchParams(panel.querySelector(".deep-link")?.getAttribute("data-query-string") ?? "").get("srcdb")
  ).pipe(Option.filter(Schema.is(Term)))

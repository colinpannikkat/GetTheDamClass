import { assert, describe, it } from "@effect/vitest"
import { classFullEmail, seatOpenedEmail } from "./emails"

const alert = {
  title: "C & C++ <ADVANCED>",
  crn: "33940",
  unsubscribeUrl: "https://api.test/unsubscribe?key=abc&x=1"
}

describe.each([
  { name: "seatOpenedEmail", email: seatOpenedEmail("student@example.com", alert), subject: "Seat open: " },
  { name: "classFullEmail", email: classFullEmail("student@example.com", alert), subject: "Full again: " }
])("$name", ({ email, subject }) => {
  it("goes to the student, and names the class in the subject, the text and the HTML", () => {
    assert.strictEqual(email.to, "student@example.com")
    assert.strictEqual(email.subject, `${subject}C & C++ <ADVANCED> (CRN 33940)`)
    assert.include(email.text, "C & C++ <ADVANCED> (CRN 33940)")
    assert.include(email.html, "C &amp; C++ &lt;ADVANCED&gt; (CRN 33940)")
    assert.notInclude(email.html, "<ADVANCED>")
  })

  it("carries the student's unsubscribe link, as text and as a link", () => {
    assert.include(email.text, alert.unsubscribeUrl)
    assert.include(email.html, `href="https://api.test/unsubscribe?key=abc&amp;x=1"`)
  })
})

describe("seatOpenedEmail", () => {
  it("says to register now, with the CRN to add and a button to the class search", () => {
    const email = seatOpenedEmail("student@example.com", alert)
    assert.include(email.text, "register now")
    assert.include(email.text, "add CRN 33940 on the class search, https://classes.oregonstate.edu/")
    assert.include(email.html, `href="https://classes.oregonstate.edu/"`)
    assert.include(email.html, "CRN 33940</p>")
  })
})

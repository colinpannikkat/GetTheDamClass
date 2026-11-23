import { assert, describe, it } from "@effect/vitest"
import { Schema } from "effect"
import { EmailAddress, SignInCode } from "./domain"

describe("EmailAddress", () => {
  const decode = Schema.decodeUnknownSync(EmailAddress)

  it("trims and lower-cases, so one inbox is one account", () => {
    assert.strictEqual(decode("  Student@OregonState.EDU "), "student@oregonstate.edu")
  })

  it("accepts any domain, not only the university's", () => {
    assert.strictEqual(decode("someone@example.com"), "someone@example.com")
  })

  it.each(["", "student", "@oregonstate.edu", "student@", "two words@example.com"])(
    "rejects %j",
    (input) => {
      assert.throws(() => decode(input))
    }
  )
})

describe("SignInCode", () => {
  const decode = Schema.decodeUnknownSync(SignInCode)

  it("accepts six digits, ignoring spaces around them", () => {
    assert.strictEqual(decode(" 012345 "), "012345")
  })

  it.each(["12345", "1234567", "12 345", "abcdef"])("rejects %j", (input) => {
    assert.throws(() => decode(input))
  })
})

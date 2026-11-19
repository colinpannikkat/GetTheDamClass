import { assert, beforeEach, describe, it } from "@effect/vitest"
import {
  AlreadySubscribed,
  CodeRecentlySent,
  EmailNotSent,
  InvalidCode,
  NotSignedIn,
  NotSubscribed,
  TermNotOpen
} from "@getthedamclass/shared/domain"
import { Effect, Fiber, Latch, Layer } from "effect"
import { TestClock } from "effect/testing"
import { fakeBrowser } from "wxt/testing/fake-browser"
import { AccountStore } from "./AccountStore"
import { Api } from "./Api"
import { type ClassId, NetworkError } from "./domain"
import {
  changeEmail,
  deleteAccount,
  listAlerts,
  requestCode,
  signIn,
  signOut,
  subscribe,
  unsubscribe
} from "./workflows"

// The workflows run here with a fake Api and the real AccountStore (on WXT's
// in-memory `browser`). `Layer.mock` builds a service from just the functions
// a test needs; calling any other function fails the test.

const email = "student@oregonstate.edu"
const other = "other@oregonstate.edu"
const token = "student-token"
const otherToken = "other-token"

const intro: ClassId = { term: "202702", crn: "33940" }
/** The same CRN in another term: another class. */
const introInFall: ClassId = { term: "202701", crn: "33940" }
const ethics: ClassId = { term: "202702", crn: "53476" }
const deepLearning: ClassId = { term: "202702", crn: "39835" }

/** An alert as the server lists it. */
const alertFor = (classId: ClassId) => ({ ...classId, title: `CLASS ${classId.crn}` })

const withFakeApi = (fakeApi: Layer.PartialEffectful<Api["Service"]>) =>
  Effect.provide(Layer.mergeAll(Layer.mock(Api, fakeApi), AccountStore.layer))

/** What is saved in the browser right now. */
const saved = Effect.gen(function*() {
  const store = yield* AccountStore
  return yield* store.get
})

/** Everything in storage, as the browser holds it. */
const raw = Effect.promise(() => fakeBrowser.storage.local.get())

/** The classes saved as watched by whoever is signed in now, sorted (storage keeps no order). */
const watching = Effect.map(saved, (account) => {
  assert.strictEqual(account.status, "signedIn")
  return account.status === "signedIn" ? account.watching.map(({ term, crn }) => `${term}/${crn}`).sort() : []
})

/** As if this user signed in earlier and already watches these classes. */
const signedInWatching = (...classes: ReadonlyArray<ClassId>) =>
  Effect.gen(function*() {
    const store = yield* AccountStore
    yield* store.save(email, token)
    yield* store.watch(email, classes)
  })

/** As if someone else signs in on this browser (in the popup, say). */
const signedInAs = (someone: string, theirToken: string) =>
  Effect.gen(function*() {
    const store = yield* AccountStore
    yield* store.save(someone, theirToken)
  })

const notSignedIn = new NotSignedIn({ message: "You're not signed in. Sign in with your email to continue." })

beforeEach(() => {
  fakeBrowser.reset()
})

describe("requestCode", () => {
  /** How many codes the fake server was asked for in the test so far. */
  let sent = 0
  beforeEach(() => {
    sent = 0
  })

  it.effect("asks the server for a code, then remembers where it went and when", () => {
    const asked: Array<string> = []
    return Effect.gen(function*() {
      yield* TestClock.setTime(60_000)
      yield* requestCode(email)
      assert.deepStrictEqual(asked, [email])
      assert.deepStrictEqual(yield* saved, {
        status: "signedOut",
        email: undefined,
        codeRequest: { email, sentAt: 60_000 }
      })
    }).pipe(withFakeApi({ sendCode: (email) => Effect.sync(() => void asked.push(email)) }))
  })

  it.effect("remembers it before the server has answered: the popup may be closed by then", () => {
    const asked = Latch.makeUnsafe()
    return Effect.gen(function*() {
      yield* TestClock.setTime(60_000)
      yield* Effect.forkChild(requestCode(email))
      yield* Latch.await(asked)
      assert.deepStrictEqual(yield* raw, { codeRequest: { email, sentAt: 60_000 } })
    }).pipe(withFakeApi({ sendCode: () => Effect.andThen(Latch.open(asked), Effect.never) }))
  })

  it.effect("remembers it too when a code went there less than a minute ago, and passes the refusal on", () =>
    Effect.gen(function*() {
      const error = yield* Effect.flip(requestCode(email))
      assert.strictEqual(error._tag, "CodeRecentlySent")
      const now = yield* saved
      assert.strictEqual(now.status === "signedOut" && now.codeRequest?.email, email)
    }).pipe(withFakeApi({ sendCode: () => Effect.fail(new CodeRecentlySent({ message: "Wait a minute." })) })))

  it.effect.each([
    { title: "the email could not be sent", error: new EmailNotSent({ message: "We couldn't send it." }) },
    { title: "no answer", error: new NetworkError({ cause: "offline" }) }
  ])("remembers nothing when $title", ({ error }) =>
    Effect.gen(function*() {
      assert.strictEqual((yield* Effect.flip(requestCode(email)))._tag, error._tag)
      assert.deepStrictEqual(yield* raw, {})
    }).pipe(withFakeApi({ sendCode: () => Effect.fail(error) })))

  it.effect.each([
    { title: "a code went there less than a minute ago", error: new CodeRecentlySent({ message: "Wait a minute." }) },
    { title: "the email could not be sent", error: new EmailNotSent({ message: "We couldn't send it." }) },
    { title: "no answer", error: new NetworkError({ cause: "offline" }) }
  ])("a new code that fails ($title) keeps the time of the code really sent", ({ error }) =>
    Effect.gen(function*() {
      yield* TestClock.setTime(60_000)
      yield* requestCode(email)
      yield* TestClock.setTime(90_000)
      assert.strictEqual((yield* Effect.flip(requestCode(email)))._tag, error._tag)
      assert.deepStrictEqual(yield* raw, { codeRequest: { email, sentAt: 60_000 } })
    }).pipe(withFakeApi({ sendCode: () => (sent++ === 0 ? Effect.void : Effect.fail(error)) })))
})

describe("signIn", () => {
  it.effect("saves the email and the token once the server accepts the code, and forgets the code request", () => {
    const sent: Array<[string, string]> = []
    return Effect.gen(function*() {
      yield* requestCode(email)
      yield* signIn(email, "012345")
      assert.deepStrictEqual(sent, [[email, "012345"]])
      assert.deepStrictEqual(yield* raw, { email, token })
    }).pipe(withFakeApi({
      sendCode: () => Effect.void,
      signIn: (email, code) => Effect.sync(() => (sent.push([email, code]), token))
    }))
  })

  it.effect("saves nothing, and keeps the code request, when the server refuses the code", () =>
    Effect.gen(function*() {
      yield* requestCode(email)
      const error = yield* Effect.flip(signIn(email, "999999"))
      assert.strictEqual(error._tag, "InvalidCode")
      const now = yield* saved
      assert.strictEqual(now.status, "signedOut")
      assert.strictEqual(now.status === "signedOut" && now.codeRequest?.email, email)
    }).pipe(withFakeApi({
      sendCode: () => Effect.void,
      signIn: () => Effect.fail(new InvalidCode({ message: "That code isn't right." }))
    })))

  it.effect("another account starts with an empty watch list; the same one keeps its list", () =>
    Effect.gen(function*() {
      yield* signedInWatching(intro)

      yield* signIn(email, "012345")
      assert.deepStrictEqual(yield* watching, ["202702/33940"])

      yield* signIn(other, "012345")
      assert.deepStrictEqual(yield* watching, [])
    }).pipe(withFakeApi({ signIn: () => Effect.succeed("a-new-token") })))
})

describe("changeEmail", () => {
  it.effect("forgets the code request, so the form goes back to the email step", () =>
    Effect.gen(function*() {
      yield* requestCode(email)
      yield* changeEmail()
      assert.deepStrictEqual(yield* raw, {})
    }).pipe(withFakeApi({ sendCode: () => Effect.void })))
})

describe("signOut", () => {
  it.effect("leaves nothing saved, of any account, and ends the token on the server", () => {
    const ended: Array<string> = []
    return Effect.gen(function*() {
      yield* signedInWatching(intro)
      yield* signedInAs(other, otherToken)
      yield* subscribe(ethics)
      yield* signOut()
      assert.deepStrictEqual(ended, [otherToken])
      assert.deepStrictEqual(yield* raw, {})
    }).pipe(withFakeApi({
      subscribe: (_token, classId) => Effect.succeed(alertFor(classId)),
      signOut: (token) => Effect.sync(() => void ended.push(token))
    }))
  })

  it.effect("forgets before asking the server, and gives up on a server that does not answer within 5 seconds", () => {
    const asked = Latch.makeUnsafe()
    return Effect.gen(function*() {
      yield* signedInWatching(intro)
      const pending = yield* Effect.forkChild(signOut())
      yield* Latch.await(asked)
      // Signed out already, while the server has not answered.
      assert.deepStrictEqual(yield* raw, {})

      yield* TestClock.adjust("5 seconds")
      yield* Fiber.join(pending)
    }).pipe(withFakeApi({ signOut: () => Effect.andThen(Latch.open(asked), Effect.never) }))
  })

  it.effect.each([
    { title: "cannot be reached", error: new NetworkError({ cause: "offline" }) },
    { title: "no longer knows the token", error: notSignedIn }
  ])("forgets everything all the same when the server $title", ({ error }) =>
    Effect.gen(function*() {
      yield* signedInWatching(intro)
      yield* signOut()
      assert.deepStrictEqual(yield* raw, {})
    }).pipe(withFakeApi({ signOut: () => Effect.fail(error) })))

  it.effect("only forgets when nobody is signed in, without calling the server", () =>
    Effect.gen(function*() {
      yield* requestCode(email)
      yield* signOut()
      assert.deepStrictEqual(yield* raw, {})
    }).pipe(withFakeApi({ sendCode: () => Effect.void })))
})

describe("deleteAccount", () => {
  it.effect("deletes the account on the server with the saved token, then leaves nothing saved", () => {
    const deleted: Array<string> = []
    return Effect.gen(function*() {
      yield* signedInWatching(intro)
      yield* deleteAccount()
      assert.deepStrictEqual(deleted, [token])
      assert.deepStrictEqual(yield* raw, {})
    }).pipe(withFakeApi({ deleteAccount: (token) => Effect.sync(() => void deleted.push(token)) }))
  })

  it.effect("forgets nothing when the server could not delete it: the account still exists", () =>
    Effect.gen(function*() {
      yield* signedInWatching(intro)
      assert.strictEqual((yield* Effect.flip(deleteAccount()))._tag, "NetworkError")
      assert.deepStrictEqual(yield* watching, ["202702/33940"])
    }).pipe(withFakeApi({ deleteAccount: () => Effect.fail(new NetworkError({ cause: "offline" })) })))

  it.effect("fails with NotSignedIn, without calling the server, when nobody is signed in", () =>
    Effect.gen(function*() {
      assert.strictEqual((yield* Effect.flip(deleteAccount()))._tag, "NotSignedIn")
    }).pipe(withFakeApi({})))
})

describe("subscribe, unsubscribe and listAlerts", () => {
  it.effect("fail with NotSignedIn, without calling the server, when nobody is signed in", () =>
    Effect.gen(function*() {
      assert.strictEqual((yield* Effect.flip(subscribe(intro)))._tag, "NotSignedIn")
      assert.strictEqual((yield* Effect.flip(unsubscribe(intro)))._tag, "NotSignedIn")
      assert.strictEqual((yield* Effect.flip(listAlerts()))._tag, "NotSignedIn")
      // An empty fake: any call to the server would have failed this test.
    }).pipe(withFakeApi({})))

  it.effect("send the saved token, and the class's term and CRN", () => {
    const calls: Array<unknown> = []
    return Effect.gen(function*() {
      yield* signedInWatching()

      yield* subscribe(intro)
      yield* unsubscribe(introInFall)
      const alerts = yield* listAlerts()

      assert.deepStrictEqual(alerts, [alertFor(intro)])
      assert.deepStrictEqual(calls, [
        ["subscribe", token, intro],
        ["unsubscribe", token, introInFall],
        ["listAlerts", token]
      ])
    }).pipe(withFakeApi({
      subscribe: (token, classId) => Effect.sync(() => (calls.push(["subscribe", token, classId]), alertFor(classId))),
      unsubscribe: (token, classId) => Effect.sync(() => void calls.push(["unsubscribe", token, classId])),
      listAlerts: (token) => Effect.sync(() => (calls.push(["listAlerts", token]), [alertFor(intro)]))
    }))
  })

  it.effect("pass the server's refusal on as it is", () =>
    Effect.gen(function*() {
      yield* signedInWatching()
      const error = yield* Effect.flip(subscribe(intro))
      assert.deepStrictEqual(error, new TermNotOpen({ message: "Seat alerts for Spring 2027 start when registration opens." }))
      assert.deepStrictEqual(yield* watching, [])
    }).pipe(withFakeApi({
      subscribe: () => Effect.fail(new TermNotOpen({ message: "Seat alerts for Spring 2027 start when registration opens." }))
    })))
})

describe("a sign-in the server no longer accepts", () => {
  const rejectingApi = withFakeApi({
    deleteAccount: () => Effect.fail(notSignedIn),
    subscribe: () => Effect.fail(notSignedIn),
    unsubscribe: () => Effect.fail(notSignedIn),
    listAlerts: () => Effect.fail(notSignedIn)
  })

  it.effect.each([
    { name: "subscribe", call: subscribe(ethics) },
    { name: "unsubscribe", call: unsubscribe(intro) },
    { name: "listAlerts", call: listAlerts() },
    { name: "deleteAccount", call: deleteAccount() }
  ])("$name: signs this browser out, keeping the email for the form, and fails with NotSignedIn", ({ call }) =>
    Effect.gen(function*() {
      yield* signedInWatching(intro)
      const error = yield* Effect.flip(call)
      assert.strictEqual(error._tag, "NotSignedIn")
      assert.deepStrictEqual(yield* saved, { status: "signedOut", email, codeRequest: undefined })
    }).pipe(rejectingApi))

  it.effect("forgets the classes saved as watched by that account, and only those: its alerts may be gone", () =>
    Effect.gen(function*() {
      // Deleted in another browser, then the same address signs in again here:
      // a new account, with none of the old one's alerts.
      yield* signedInWatching(intro)
      const store = yield* AccountStore
      yield* store.watch(other, [ethics])
      yield* Effect.flip(listAlerts())

      assert.deepStrictEqual(yield* raw, { email, "watch:202702:other@oregonstate.edu:53476": true })
      yield* signedInAs(email, "a-new-token")
      assert.deepStrictEqual(yield* watching, [])
    }).pipe(rejectingApi))

  it.effect("leaves alone a sign-in made while the server was answering", () => {
    const asked = Latch.makeUnsafe()
    const letGo = Latch.makeUnsafe()
    return Effect.gen(function*() {
      yield* signedInWatching()
      const pending = yield* Effect.forkChild(Effect.flip(listAlerts()))
      yield* Latch.await(asked)

      yield* signedInAs(other, otherToken)
      yield* Latch.open(letGo)
      yield* Fiber.join(pending)

      const now = yield* saved
      assert.strictEqual(now.status === "signedIn" && now.token, otherToken)
    }).pipe(withFakeApi({
      listAlerts: () => Effect.andThen(Effect.andThen(Latch.open(asked), Latch.await(letGo)), Effect.fail(notSignedIn))
    }))
  })
})

describe("the saved watch list follows what the server says", () => {
  it.effect("subscribe adds the class, once", () =>
    Effect.gen(function*() {
      yield* signedInWatching(intro)
      yield* subscribe(ethics)
      yield* subscribe(ethics)
      assert.deepStrictEqual(yield* watching, ["202702/33940", "202702/53476"])
    }).pipe(withFakeApi({ subscribe: (_token, classId) => Effect.succeed(alertFor(classId)) })))

  it.effect("subscribe keeps the same CRN in another term apart", () =>
    Effect.gen(function*() {
      yield* signedInWatching(intro)
      yield* subscribe(introInFall)
      yield* unsubscribe(intro)
      assert.deepStrictEqual(yield* watching, ["202701/33940"])
    }).pipe(withFakeApi({
      subscribe: (_token, classId) => Effect.succeed(alertFor(classId)),
      unsubscribe: () => Effect.void
    })))

  it.effect("subscribe succeeds, and adds the class, when the server says it was subscribed already", () =>
    Effect.gen(function*() {
      yield* signedInWatching()
      yield* subscribe(ethics)
      assert.deepStrictEqual(yield* watching, ["202702/53476"])
    }).pipe(withFakeApi({ subscribe: () => Effect.fail(new AlreadySubscribed({ message: "Already." })) })))

  it.effect("a failed subscribe leaves the list alone", () =>
    Effect.gen(function*() {
      yield* signedInWatching(intro)
      assert.strictEqual((yield* Effect.flip(subscribe(ethics)))._tag, "NetworkError")
      assert.deepStrictEqual(yield* watching, ["202702/33940"])
    }).pipe(withFakeApi({ subscribe: () => Effect.fail(new NetworkError({ cause: "offline" })) })))

  it.effect("unsubscribe removes the class", () =>
    Effect.gen(function*() {
      yield* signedInWatching(intro, ethics)
      yield* unsubscribe(intro)
      assert.deepStrictEqual(yield* watching, ["202702/53476"])
    }).pipe(withFakeApi({ unsubscribe: () => Effect.void })))

  it.effect("unsubscribe succeeds, and removes the class, when the server says it was not subscribed", () =>
    Effect.gen(function*() {
      yield* signedInWatching(intro)
      yield* unsubscribe(intro)
      assert.deepStrictEqual(yield* watching, [])
    }).pipe(withFakeApi({ unsubscribe: () => Effect.fail(new NotSubscribed({ message: "Not subscribed." })) })))

  it.effect("a failed unsubscribe leaves the list alone", () =>
    Effect.gen(function*() {
      yield* signedInWatching(intro)
      assert.strictEqual((yield* Effect.flip(unsubscribe(intro)))._tag, "NetworkError")
      assert.deepStrictEqual(yield* watching, ["202702/33940"])
    }).pipe(withFakeApi({ unsubscribe: () => Effect.fail(new NetworkError({ cause: "offline" })) })))

  it.effect("listAlerts replaces the list with the server's, term and all", () =>
    Effect.gen(function*() {
      // 33940 in Winter was stopped somewhere else; the same CRN in Fall and
      // 39835 were added somewhere else.
      yield* signedInWatching(intro, ethics)
      yield* listAlerts()
      assert.deepStrictEqual(yield* watching, ["202701/33940", "202702/39835", "202702/53476"])
    }).pipe(withFakeApi({
      listAlerts: () => Effect.succeed([alertFor(ethics), alertFor(deepLearning), alertFor(introInFall)])
    })))

  it.effect("listAlerts empties the list when the server lists nothing", () =>
    Effect.gen(function*() {
      yield* signedInWatching(intro, ethics)
      yield* listAlerts()
      assert.deepStrictEqual(yield* watching, [])
    }).pipe(withFakeApi({ listAlerts: () => Effect.succeed([]) })))
})

// The server can take seconds to answer, and the popup, every open class page
// and every sign-in frame work on the same storage at once. In these tests the
// fake server holds its answer back until the test lets it go.
describe("while the server is still answering", () => {
  /** A fake call that says when it was asked, then waits to be let go. */
  const heldBack = (asked: Latch.Latch, letGo: Latch.Latch) => Effect.andThen(Latch.open(asked), Latch.await(letGo))

  it.effect("subscribe: another account signs in; the class is saved for the account that asked", () => {
    const asked = Latch.makeUnsafe()
    const letGo = Latch.makeUnsafe()
    return Effect.gen(function*() {
      yield* signedInWatching()
      const pending = yield* Effect.forkChild(subscribe(intro))
      yield* Latch.await(asked)

      yield* signedInAs(other, otherToken)
      yield* Latch.open(letGo)
      yield* Fiber.join(pending)

      // The other account does not watch a class it never asked for...
      assert.deepStrictEqual(yield* watching, [])
      // ...and the one that asked finds it when it signs in again.
      yield* signedInAs(email, token)
      assert.deepStrictEqual(yield* watching, ["202702/33940"])
    }).pipe(withFakeApi({ subscribe: () => Effect.as(heldBack(asked, letGo), alertFor(intro)) }))
  })

  it.effect("listAlerts: another account signs in; the list is saved for the account that asked", () => {
    const asked = Latch.makeUnsafe()
    const letGo = Latch.makeUnsafe()
    return Effect.gen(function*() {
      yield* signedInWatching(intro)
      const pending = yield* Effect.forkChild(listAlerts())
      yield* Latch.await(asked)

      yield* signedInAs(other, otherToken)
      yield* subscribe(deepLearning)
      yield* Latch.open(letGo)
      yield* Fiber.join(pending)

      assert.deepStrictEqual(yield* watching, ["202702/39835"])
      yield* signedInAs(email, token)
      assert.deepStrictEqual(yield* watching, ["202702/53476"])
    }).pipe(withFakeApi({
      subscribe: (_token, classId) => Effect.succeed(alertFor(classId)),
      listAlerts: () => Effect.as(heldBack(asked, letGo), [alertFor(ethics)])
    }))
  })

  it.effect("two alerts stopped and one started at the same moment: none of the three is lost", () => {
    const allAsked = Latch.makeUnsafe()
    let calls = 0
    // Every call waits until the server has all three, so they all finish together.
    const held = Effect.suspend(() => Effect.andThen(++calls === 3 ? Latch.open(allAsked) : Effect.void, Latch.await(allAsked)))
    return Effect.gen(function*() {
      yield* signedInWatching(intro, ethics)

      yield* Effect.all([unsubscribe(intro), unsubscribe(ethics), subscribe(deepLearning)], { concurrency: "unbounded" })

      assert.deepStrictEqual(yield* watching, ["202702/39835"])
    }).pipe(withFakeApi({ subscribe: () => Effect.as(held, alertFor(deepLearning)), unsubscribe: () => held }))
  })

  it.effect("listAlerts: a class subscribed to in the meantime stays saved", () => {
    const asked = Latch.makeUnsafe()
    const letGo = Latch.makeUnsafe()
    return Effect.gen(function*() {
      yield* signedInWatching(intro, ethics)
      // The popup opens and asks for the list...
      const pending = yield* Effect.forkChild(listAlerts())
      yield* Latch.await(asked)

      // ...and before the answer is back, a class page starts another alert.
      yield* subscribe(deepLearning)
      yield* Latch.open(letGo)
      yield* Fiber.join(pending)

      // 33940 was saved before and is not on the server's list: gone. 39835
      // is not on that (older) list either, but was not saved before: kept.
      assert.deepStrictEqual(yield* watching, ["202702/39835", "202702/53476"])
    }).pipe(withFakeApi({
      subscribe: (_token, classId) => Effect.succeed(alertFor(classId)),
      listAlerts: () => Effect.as(heldBack(asked, letGo), [alertFor(ethics)])
    }))
  })

  it.effect("listAlerts: an alert stopped in the meantime stays stopped", () => {
    const asked = Latch.makeUnsafe()
    const letGo = Latch.makeUnsafe()
    return Effect.gen(function*() {
      yield* signedInWatching(intro, ethics)
      // The popup opens and asks for the list...
      const pending = yield* Effect.forkChild(listAlerts())
      yield* Latch.await(asked)

      // ...and before the answer is back, a class page stops one alert.
      yield* unsubscribe(intro)
      yield* Latch.open(letGo)
      yield* Fiber.join(pending)

      // The server's (older) list still has 33940. It must not come back.
      assert.deepStrictEqual(yield* watching, ["202702/53476"])
    }).pipe(withFakeApi({
      unsubscribe: () => Effect.void,
      listAlerts: () => Effect.as(heldBack(asked, letGo), [alertFor(intro), alertFor(ethics)])
    }))
  })
})

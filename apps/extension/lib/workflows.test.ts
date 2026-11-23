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
  type CodeNotSent,
  deleteAccount,
  listAlerts,
  requestCode,
  signIn,
  signOut,
  subscribe,
  unsubscribe
} from "./workflows"

const email = "student@oregonstate.edu"
const other = "other@oregonstate.edu"
const token = "student-token"
const otherToken = "other-token"

const intro: ClassId = { term: "202702", crn: "33940" }
const introInFall: ClassId = { term: "202701", crn: "33940" }
const ethics: ClassId = { term: "202702", crn: "53476" }
const deepLearning: ClassId = { term: "202702", crn: "39835" }

const alertFor = (classId: ClassId) => ({ ...classId, title: `CLASS ${classId.crn}` })

const withFakeApi = (fakeApi: Layer.PartialEffectful<Api["Service"]>) =>
  Effect.provide(Layer.mergeAll(Layer.mock(Api, fakeApi), AccountStore.layer))

const saved = Effect.gen(function*() {
  const store = yield* AccountStore
  return yield* store.get
})

const raw = Effect.promise(() => fakeBrowser.storage.local.get())

const watching = Effect.map(saved, (account) => {
  assert.strictEqual(account.status, "signedIn")
  return account.status === "signedIn" ? account.watching.map(({ term, crn }) => `${term}/${crn}`).sort() : []
})

const signedInWatching = (...classes: ReadonlyArray<ClassId>) =>
  Effect.gen(function*() {
    const store = yield* AccountStore
    yield* store.save(email, token)
    yield* store.watch(email, classes)
  })

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
  let sent = 0
  beforeEach(() => {
    sent = 0
  })

  const recentlySent = new CodeRecentlySent({ message: "Wait a minute." })
  const emailNotSent = new EmailNotSent({ message: "We couldn't send it." })
  const noAnswer = new NetworkError({ cause: "offline" })

  const whyNotSent = (error: Effect.Error<ReturnType<typeof requestCode>>) =>
    error._tag === "CodeNotSent" ? [error.reason._tag, error.codeStepFor] : [error._tag]

  const firstSentThen = (error: CodeNotSent["reason"]) => ({
    sendCode: () => (sent++ === 0 ? Effect.void : Effect.fail(error))
  })

  it.effect("remembers where the code was asked for and when, and asks the server for it", () => {
    const asked: Array<string> = []
    return Effect.gen(function*() {
      yield* TestClock.setTime(60_000)
      yield* requestCode(email)
      assert.deepStrictEqual(asked, [email])
      assert.deepStrictEqual(yield* saved, {
        status: "signedOut",
        email: undefined,
        codeRequest: { email, requestedAt: 60_000 }
      })
    }).pipe(withFakeApi({ sendCode: (email) => Effect.sync(() => void asked.push(email)) }))
  })

  it.effect("remembers it before the server has answered: the popup may be closed by then", () => {
    const asked = Latch.makeUnsafe()
    return Effect.gen(function*() {
      yield* TestClock.setTime(60_000)
      yield* Effect.forkChild(requestCode(email))
      yield* Latch.await(asked)
      assert.deepStrictEqual(yield* raw, { codeRequest: { email, requestedAt: 60_000 } })
    }).pipe(withFakeApi({ sendCode: () => Effect.andThen(Latch.open(asked), Effect.never) }))
  })

  it.effect("stays at the code step when a code went there less than a minute ago, and passes the refusal on", () =>
    Effect.gen(function*() {
      yield* TestClock.setTime(60_000)
      assert.deepStrictEqual(whyNotSent(yield* Effect.flip(requestCode(email))), ["CodeRecentlySent", email])
      assert.deepStrictEqual(yield* raw, { codeRequest: { email, requestedAt: 60_000 } })
    }).pipe(withFakeApi({ sendCode: () => Effect.fail(recentlySent) })))

  it.effect.each([
    { title: "the email could not be sent", error: emailNotSent },
    { title: "no answer", error: noAnswer }
  ])("remembers nothing, and is back at the email step, when $title", ({ error }) =>
    Effect.gen(function*() {
      assert.deepStrictEqual(whyNotSent(yield* Effect.flip(requestCode(email))), [error._tag, undefined])
      assert.deepStrictEqual(yield* raw, {})
    }).pipe(withFakeApi({ sendCode: () => Effect.fail(error) })))

  it.effect.each([
    { title: "a code went there less than a minute ago", error: recentlySent },
    { title: "no answer", error: noAnswer }
  ])("a new code that fails ($title) keeps the earlier code's request, and its time", ({ error }) =>
    Effect.gen(function*() {
      yield* TestClock.setTime(60_000)
      yield* requestCode(email)
      yield* TestClock.setTime(90_000)
      assert.deepStrictEqual(whyNotSent(yield* Effect.flip(requestCode(email))), [error._tag, email])
      assert.deepStrictEqual(yield* raw, { codeRequest: { email, requestedAt: 60_000 } })
    }).pipe(withFakeApi(firstSentThen(error))))

  it.effect("a new code whose email could not be sent leaves no code request: the server forgot both codes", () =>
    Effect.gen(function*() {
      yield* requestCode(email)
      assert.deepStrictEqual(whyNotSent(yield* Effect.flip(requestCode(email))), ["EmailNotSent", undefined])
      assert.deepStrictEqual(yield* raw, {})
    }).pipe(withFakeApi(firstSentThen(emailNotSent))))

  it.effect("a new code that fails once the earlier one's 15 minutes are over is back at the email step", () =>
    Effect.gen(function*() {
      yield* requestCode(email)
      yield* TestClock.setTime(16 * 60_000)
      assert.deepStrictEqual(whyNotSent(yield* Effect.flip(requestCode(email))), ["NetworkError", undefined])
      assert.deepStrictEqual(yield* raw, {})
    }).pipe(withFakeApi(firstSentThen(noAnswer))))

  it.effect.each([
    {
      title: "\"Use a different email\"",
      meanwhile: changeEmail(),
      expected: {}
    },
    {
      title: "a code asked for another address elsewhere",
      meanwhile: Effect.gen(function*() {
        const store = yield* AccountStore
        yield* store.saveCodeRequest({ email: other, requestedAt: 70_000 })
      }),
      expected: { codeRequest: { email: other, requestedAt: 70_000 } }
    },
    {
      title: "a sign-in elsewhere",
      meanwhile: signedInAs(other, otherToken),
      expected: { email: other, token: otherToken }
    }
  ])("a refusal that comes after $title changes nothing, and has nothing to say", ({ meanwhile, expected }) => {
    const asked = Latch.makeUnsafe()
    const answer = Latch.makeUnsafe()
    return Effect.gen(function*() {
      yield* requestCode(email)
      yield* TestClock.setTime(60_000)
      const resend = yield* Effect.forkChild(Effect.flip(requestCode(email)))
      yield* Latch.await(asked)
      yield* meanwhile
      yield* Latch.open(answer)
      assert.deepStrictEqual(whyNotSent(yield* Fiber.join(resend)), ["CodeRequestOvertaken"])
      assert.deepStrictEqual(yield* raw, expected)
    }).pipe(withFakeApi({
      sendCode: () =>
        sent++ === 0
          ? Effect.void
          : Latch.open(asked).pipe(Effect.andThen(Latch.await(answer)), Effect.andThen(Effect.fail(noAnswer)))
    }))
  })
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

describe("while the server is still answering", () => {
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

      assert.deepStrictEqual(yield* watching, [])
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
      const pending = yield* Effect.forkChild(listAlerts())
      yield* Latch.await(asked)

      yield* subscribe(deepLearning)
      yield* Latch.open(letGo)
      yield* Fiber.join(pending)

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
      const pending = yield* Effect.forkChild(listAlerts())
      yield* Latch.await(asked)

      yield* unsubscribe(intro)
      yield* Latch.open(letGo)
      yield* Fiber.join(pending)

      assert.deepStrictEqual(yield* watching, ["202702/53476"])
    }).pipe(withFakeApi({
      unsubscribe: () => Effect.void,
      listAlerts: () => Effect.as(heldBack(asked, letGo), [alertFor(intro), alertFor(ethics)])
    }))
  })
})

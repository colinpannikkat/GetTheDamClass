/**
 * What this browser remembers: who is signed in (their email and the sign-in
 * token the server gave this browser), which classes they are watching, and a
 * sign-in code that was asked for and not used yet.
 *
 * It is kept in the browser's extension storage (`chrome.storage.local`),
 * which every part of the extension shares: the popup, the "Notify me" control
 * on the class page, and the sign-in form framed inside that page. Each of
 * them follows `changes`, so a sign-in or a stopped alert in one place shows
 * up in the others.
 *
 * What is stored:
 *
 *   email                                         "student@oregonstate.edu"
 *   token                                         "kq3V..."
 *   codeRequest                                   { "email": "student@oregonstate.edu", "requestedAt": 1795075200000 }
 *   watch:202702:student@oregonstate.edu:33940    true
 *
 * `email` without `token` is someone signed out whose address is still known,
 * so the sign-in form can start with it: after the server stopped accepting
 * the token, or after updating from a version that signed in with a PIN.
 *
 * Every watched class is a key of its own, named after the term, the account
 * and the CRN. That makes two things safe without any locking:
 *
 * - Adding a class is one write and removing it one delete. Neither reads the
 *   list first, so changes to two different classes made at the same moment
 *   (in the popup and on a class page, say) cannot undo each other.
 * - An answer from the server that arrives after someone else signed in is
 *   saved under the account that asked, where the other account never sees it.
 */
import { EmailAddress } from "@getthedamclass/shared/domain"
import { Clock, Context, Duration, Effect, Layer, Option, Queue, Schema, Stream } from "effect"
import { browser } from "wxt/browser"
import { type ClassId, StorageError } from "./domain"

/** Someone signed in on this browser. */
export interface Account {
  readonly email: EmailAddress
  /** The sign-in token the server gave this browser. Sent with every call. */
  readonly token: string
  /**
   * The classes this user gets alerts for, as far as this browser knows, in no
   * particular order, so the class page can show "Watching" without asking
   * the server. The server holds the real list. Starting or stopping an alert
   * here adds or removes that one class; only `listAlerts` (run when the
   * popup opens) brings the whole list in line with the server's. An alert
   * that ended elsewhere (the link in an email, another browser, the server's
   * daily cleanup) therefore stays here until the popup is next opened. See
   * `lib/workflows.ts`.
   */
  readonly watching: ReadonlyArray<ClassId>
}

/**
 * A sign-in code for this address was asked for at `requestedAt`
 * (milliseconds since 1970), and has not been used yet. Remembered so that
 * the sign-in form can come back at the step where the code is typed: the
 * browser closes the popup as soon as the student switches to their inbox to
 * read it. It is saved before the server answers (see `requestCode` in
 * `lib/workflows.ts`), so the email may still be on its way, or may never
 * come.
 */
export interface CodeRequest {
  readonly email: EmailAddress
  readonly requestedAt: number
}

/** Everything the store holds, as one value. */
export type Saved =
  & (
    | ({ readonly status: "signedIn" } & Account)
    | {
      readonly status: "signedOut"
      /** The address last used on this browser, to start the sign-in form with. */
      readonly email: EmailAddress | undefined
    }
  )
  & {
    /**
     * A code asked for less than 15 minutes ago and not used yet. Signing in
     * removes it, so it is almost always signed out. Not quite always: a form
     * that has not yet seen a sign-in made elsewhere a moment ago can still
     * ask for a code, and that request then stays until its 15 minutes are
     * over or the next sign-in or sign-out.
     */
    readonly codeRequest: CodeRequest | undefined
  }

/**
 * How long a sign-in code works. It is the server's rule (apps/server/src/
 * signIn.ts, counted from when the server stored the code, a moment after it
 * was asked for); after that the code no longer signs anyone in, so the form
 * no longer offers to type it.
 */
const CODE_LIFETIME = Duration.minutes(15)

/** How the storage key of a watched class starts. Term, email and CRN follow. */
const WATCH_PREFIX = "watch:"

/** The storage key of one class watched by the account with this email: "watch:202702:student@oregonstate.edu:33940". */
const watchKey = (email: EmailAddress, { term, crn }: ClassId) => `${WATCH_PREFIX}${term}:${email}:${crn}`

/**
 * Read a watch key back: the email it belongs to and the class. The term is
 * six digits and the CRN digits, so whatever lies between them is the email.
 */
const parseWatchKey = (key: string): Option.Option<{ readonly email: string; readonly classId: ClassId }> =>
  Option.map(
    Option.fromNullishOr(key.match(/^watch:(\d{6}):(.+):(\d+)$/)),
    ([, term, email, crn]) => ({ email: email!, classId: { term: term!, crn: crn! } })
  )

export class AccountStore extends Context.Service<AccountStore, {
  /**
   * Everything saved. Reading also removes a code request whose 15 minutes
   * are over, so every part of the extension stops offering its code step.
   */
  readonly get: Effect.Effect<Saved, StorageError>
  /** Remember who signed in, and forget the code they signed in with. */
  save(email: EmailAddress, token: string): Effect.Effect<void, StorageError>
  /**
   * The server no longer accepts this token: forget it, so this browser is
   * signed out, and forget the classes saved as watched by its account. The
   * email stays, for the sign-in form. A token that is not the saved one any
   * more (someone signed in again since) is left alone.
   *
   * The classes go because the account may be gone (deleted from another
   * browser). Kept, they would show as "Watching" again when the same
   * address signs in, to a new account that has no such alerts. If the
   * account still exists, the popup lists them again when it next opens, and
   * "Notify me" on one meanwhile only hears "already subscribed".
   */
  forgetToken(token: string): Effect.Effect<void, StorageError>
  /** Forget everything, of every account (sign out on this browser). */
  readonly clear: Effect.Effect<void, StorageError>
  /** Remember that a code for this address was asked for at this time. */
  saveCodeRequest(request: CodeRequest): Effect.Effect<void, StorageError>
  /**
   * Replace the saved code request with `next` (`undefined` forgets it), but
   * only while the saved one is still `expected`, and say whether it was.
   * That is how a request whose code did not go out is undone without
   * undoing what the student did meanwhile ("Use a different email", a code
   * asked for in another part of the extension, a sign-in or a sign-out).
   */
  replaceCodeRequest(expected: CodeRequest, next: CodeRequest | undefined): Effect.Effect<boolean, StorageError>
  /** Forget the code that was asked for (the student wants to use another address). */
  readonly forgetCodeRequest: Effect.Effect<void, StorageError>
  /** Note that the account with this email gets alerts for these classes. */
  watch(email: EmailAddress, classes: ReadonlyArray<ClassId>): Effect.Effect<void, StorageError>
  /** Note that it no longer gets alerts for these classes. */
  unwatch(email: EmailAddress, classes: ReadonlyArray<ClassId>): Effect.Effect<void, StorageError>
  /**
   * A stream of what is saved: the current value straight away, then a new
   * value every time it changes, wherever in the extension that happens.
   */
  readonly changes: Stream.Stream<Saved, StorageError>
}>()("getthedamclass/AccountStore") {
  /**
   * The real implementation. Tests use it too, with WXT's in-memory `browser`.
   *
   * Building it first removes what versions 1 and 2 of the extension saved
   * for the old server, which every part of the extension does as soon as it
   * starts: the PIN, kept as it was typed, and the watched classes, which
   * were alerts on the old server and are not on the new one. The email
   * stays, so the student only has to ask for a code. Only an install that
   * still has a `pin` has any of this, so it happens once.
   */
  static readonly layer = Layer.effect(AccountStore, removeOldServersData().pipe(Effect.as(makeAccountStore())))
}

// The functions below are declarations, not `const`s, so that they can be
// used above, in `AccountStore`'s static field, which runs while the class is
// being defined.

/** One call to the storage API, with a rejection turned into a `StorageError`. */
function storage<A>(call: () => Promise<A>) {
  return Effect.tryPromise({ try: call, catch: (cause) => new StorageError({ cause }) })
}

function makeAccountStore(): AccountStore["Service"] {
  // Anything that does not fit counts as not saved.
  const decodeEmail = Schema.decodeUnknownOption(EmailAddress)
  const decodeToken = Schema.decodeUnknownOption(Schema.NonEmptyString)
  const decodeCodeRequest = Schema.decodeUnknownOption(
    Schema.Struct({ email: EmailAddress, requestedAt: Schema.Number })
  )

  const forgetCodeRequest = storage(() => browser.storage.local.remove("codeRequest"))

  // `get()` without a key reads everything this extension has stored.
  const get = Effect.gen(function*() {
    const saved = yield* storage(() => browser.storage.local.get())
    const now = yield* Clock.currentTimeMillis
    const email = decodeEmail(saved.email)
    const token = decodeToken(saved.token)
    const request = decodeCodeRequest(saved.codeRequest)
    const expired = Option.filter(request, (request) => now >= request.requestedAt + Duration.toMillis(CODE_LIFETIME))
    if (Option.isSome(expired)) {
      // The code no longer works, so the address it went to (perhaps
      // mistyped, by someone who gave up) is not kept either. Like
      // `forgetToken`, this reads and then removes: a new request saved in
      // the few milliseconds between the two would be removed with it.
      yield* forgetCodeRequest
    }
    const codeRequest = Option.isSome(expired) ? undefined : Option.getOrUndefined(request)

    if (Option.isSome(email) && Option.isSome(token)) {
      const watching = Object.keys(saved).flatMap((key) =>
        Option.match(parseWatchKey(key), {
          onNone: () => [],
          // Only this account's: another account's classes stay saved for it.
          onSome: (watched) => (watched.email === email.value ? [watched.classId] : [])
        })
      )
      return { status: "signedIn", email: email.value, token: token.value, watching, codeRequest } satisfies Saved
    }
    return { status: "signedOut", email: Option.getOrUndefined(email), codeRequest } satisfies Saved
  })

  const save = (email: EmailAddress, token: string) =>
    storage(async () => {
      await browser.storage.local.set({ email, token })
      await browser.storage.local.remove("codeRequest")
    })

  const forgetToken = (token: string) =>
    storage(async () => {
      // Read, compare, then remove: another part of the extension could sign
      // in between the two. That window is a few milliseconds, and the worst
      // it can do is sign out someone who has just signed in.
      const saved = await browser.storage.local.get()
      if (saved.token === token) {
        const watchKeys = Object.keys(saved).filter((key) =>
          Option.exists(parseWatchKey(key), (watched) => watched.email === saved.email)
        )
        await browser.storage.local.remove(["token", ...watchKeys])
      }
    })

  const clear = storage(() => browser.storage.local.clear())

  const saveCodeRequest = ({ email, requestedAt }: CodeRequest) =>
    storage(() => browser.storage.local.set({ codeRequest: { email, requestedAt } satisfies CodeRequest }))

  const replaceCodeRequest = (expected: CodeRequest, next: CodeRequest | undefined) =>
    Effect.gen(function*() {
      // Read, compare, then write, like `forgetToken`: a change made in the
      // few milliseconds between the two would be overwritten.
      const saved = yield* storage(() => browser.storage.local.get("codeRequest"))
      const stillExpected = Option.exists(
        decodeCodeRequest(saved.codeRequest),
        (request) => request.email === expected.email && request.requestedAt === expected.requestedAt
      )
      if (stillExpected) {
        yield* next === undefined ? forgetCodeRequest : saveCodeRequest(next)
      }
      return stillExpected
    })

  const watch = (email: EmailAddress, classes: ReadonlyArray<ClassId>) =>
    storage(() => browser.storage.local.set(Object.fromEntries(classes.map((watched) => [watchKey(email, watched), true]))))

  const unwatch = (email: EmailAddress, classes: ReadonlyArray<ClassId>) =>
    storage(() => browser.storage.local.remove(classes.map((watched) => watchKey(email, watched))))

  // `Stream.callback` turns a listener-style browser API into a stream: we
  // push a "something changed" signal into `queue`, and the stream emits it.
  const changeSignals = Stream.callback<void>(Effect.fn(function*(queue) {
    // Everything in this storage is ours, so any change is worth a new look.
    const onChanged = () => {
      Queue.offerUnsafe(queue, undefined)
    }
    // `acquireRelease` pairs "start listening" with "stop listening": the
    // second function runs when the stream's consumer goes away.
    yield* Effect.acquireRelease(
      Effect.sync(() => browser.storage.local.onChanged.addListener(onChanged)),
      () => Effect.sync(() => browser.storage.local.onChanged.removeListener(onChanged))
    )
    // One signal up front, so the stream starts with the current value.
    Queue.offerUnsafe(queue, undefined)
  }))

  // For every signal, read everything again.
  const changes = changeSignals.pipe(Stream.mapEffect(() => get))

  return {
    get,
    save,
    forgetToken,
    clear,
    saveCodeRequest,
    replaceCodeRequest,
    forgetCodeRequest,
    watch,
    unwatch,
    changes
  }
}

/**
 * See `AccountStore.layer`. If storage cannot be read or written, nothing is
 * removed and the next start tries again: the rest of the extension still
 * works, and treats such an install as signed out (it has no token).
 */
function removeOldServersData() {
  return storage(async () => {
    const saved = await browser.storage.local.get()
    if ("pin" in saved) {
      await browser.storage.local.remove(["pin", ...Object.keys(saved).filter((key) => key.startsWith(WATCH_PREFIX))])
    }
  }).pipe(Effect.ignore)
}

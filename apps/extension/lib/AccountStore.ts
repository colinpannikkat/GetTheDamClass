/**
 * What this browser remembers about the signed-in user: the email and PIN, and
 * which classes they are watching.
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
 *   pin                                           "1234"
 *   watch:202702:student@oregonstate.edu:33940    true
 *
 * Every watched class is a key of its own, named after the term, the account
 * and the CRN. That makes three things safe without any locking:
 *
 * - Adding a class is one write and removing it one delete. Neither reads the
 *   list first, so two changes made at the same moment (in the popup and on a
 *   class page, say) cannot undo each other.
 * - An answer from the server that arrives after someone else signed in is
 *   saved under the account that asked, where the other account never sees it.
 * - When `lib/term.ts` moves to the next term, last term's keys stop matching,
 *   so a CRN the new term reuses for another class does not show as watched.
 *   (The server's own list has no term, so last term's alerts must also be
 *   cleared there: see "Each term" in the README.)
 */
import { Context, Effect, Layer, Option, Queue, Schema, Stream } from "effect"
import { browser } from "wxt/browser"
import { Credentials, Crn, StorageError } from "./domain"
import { SUPPORTED_TERM } from "./term"

export interface Account {
  readonly credentials: Credentials
  /**
   * The CRNs this user gets alerts for, as far as this browser knows, in no
   * particular order. The server holds the real list; this copy is brought up
   * to date after every call to it (see `lib/workflows.ts`), so the class
   * page can show "Watching" without asking the server.
   */
  readonly watching: ReadonlyArray<Crn>
}

/**
 * How the storage key of every class watched by one account starts. The CRN
 * follows: "watch:202702:student@oregonstate.edu:33940".
 */
const watchPrefix = (email: string) => `watch:${SUPPORTED_TERM.code}:${email}:`

export class AccountStore extends Context.Service<AccountStore, {
  /** The saved account, or `Option.none()` when nobody is signed in. */
  readonly get: Effect.Effect<Option.Option<Account>, StorageError>
  /** Remember who is signed in. */
  save(credentials: Credentials): Effect.Effect<void, StorageError>
  /** Forget everything, of every account (sign out on this browser). */
  readonly clear: Effect.Effect<void, StorageError>
  /** Note that the account with this email gets alerts for these classes. */
  watch(email: string, crns: ReadonlyArray<Crn>): Effect.Effect<void, StorageError>
  /** Note that it no longer gets alerts for these classes. */
  unwatch(email: string, crns: ReadonlyArray<Crn>): Effect.Effect<void, StorageError>
  /**
   * A stream of the saved account: the current value straight away, then a
   * new value every time it changes, wherever in the extension that happens.
   */
  readonly changes: Stream.Stream<Option.Option<Account>, StorageError>
}>()("getthedamclass/AccountStore") {
  /** The real implementation. Tests use it too, with WXT's in-memory `browser`. */
  static readonly layer = Layer.succeed(AccountStore, makeAccountStore())
}

function makeAccountStore(): AccountStore["Service"] {
  /** One call to the storage API, with a rejection turned into a `StorageError`. */
  const storage = <A>(call: () => Promise<A>) =>
    Effect.tryPromise({ try: call, catch: (cause) => new StorageError({ cause }) })

  // Anything that is not a valid email and PIN counts as "not signed in".
  const decodeCredentials = Schema.decodeUnknownOption(Credentials)
  const isCrn = Schema.is(Crn)

  // `get()` without a key reads everything this extension has stored.
  const get = storage(() => browser.storage.local.get()).pipe(
    Effect.map((saved) =>
      Option.map(decodeCredentials(saved), (credentials): Account => {
        // This account's watch keys, with everything but the CRN cut off.
        const prefix = watchPrefix(credentials.email)
        const watching = Object.keys(saved)
          .filter((key) => key.startsWith(prefix))
          .map((key) => key.slice(prefix.length))
          .filter(isCrn)
        return { credentials, watching }
      })
    )
  )

  // Version 1 of the extension saved these same two keys, so people who
  // update it in place stay signed in. Do not rename them.
  const save = (credentials: Credentials) =>
    storage(() => browser.storage.local.set({ email: credentials.email, pin: credentials.pin }))

  const clear = storage(() => browser.storage.local.clear())

  const watch = (email: string, crns: ReadonlyArray<Crn>) =>
    storage(() => browser.storage.local.set(Object.fromEntries(crns.map((crn) => [watchPrefix(email) + crn, true]))))

  const unwatch = (email: string, crns: ReadonlyArray<Crn>) =>
    storage(() => browser.storage.local.remove(crns.map((crn) => watchPrefix(email) + crn)))

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

  // For every signal, read the account again.
  const changes = changeSignals.pipe(Stream.mapEffect(() => get))

  // A plain object rather than `AccountStore.of(...)`: this function is
  // called while the class above is still being defined.
  return { get, save, clear, watch, unwatch, changes }
}

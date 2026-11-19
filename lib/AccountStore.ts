/**
 * What this browser remembers about the signed-in user: the email and PIN, and
 * which classes they are watching.
 *
 * It is kept in the browser's extension storage (`chrome.storage.local`),
 * which every part of the extension shares: the popup, the "Notify me" control
 * on the class page, and the sign-in form framed inside that page. None of
 * them talks to another directly. Each one follows `changes`, so a sign-in or
 * a stopped alert in one place shows up in the others.
 */
import { Context, Effect, Layer, Option, Queue, Schema, Stream } from "effect"
import { browser } from "wxt/browser"
import { Credentials, Crn, StorageError } from "./domain"

export interface Account {
  readonly credentials: Credentials
  /**
   * The CRNs this user gets alerts for, as far as this browser knows. The
   * server holds the real list; this copy is brought up to date after every
   * call to it (see `lib/workflows.ts`), so the class page can show
   * "Watching" without asking the server.
   */
  readonly watching: ReadonlyArray<Crn>
}

/**
 * The storage keys. Version 1 of the extension used `email` and `pin`, so
 * people who signed in with it stay signed in. Do not rename them.
 */
const STORAGE_KEYS = ["email", "pin", "watching"]

export class AccountStore extends Context.Service<AccountStore, {
  /** The saved account, or `Option.none()` when nobody is signed in. */
  readonly get: Effect.Effect<Option.Option<Account>, StorageError>
  /**
   * Remember who is signed in. If it is not the same email as before, the
   * list of watched classes starts empty.
   */
  save(credentials: Credentials): Effect.Effect<void, StorageError>
  /** Forget everything (sign out on this browser). */
  readonly clear: Effect.Effect<void, StorageError>
  /**
   * Change the list of watched classes: `update` is given the saved list and
   * returns the new one. Does nothing when nobody is signed in.
   */
  updateWatching(update: (watching: ReadonlyArray<Crn>) => ReadonlyArray<Crn>): Effect.Effect<void, StorageError>
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

  // Anything that is not a valid email and PIN counts as "not signed in", and
  // anything that is not a list of CRNs as "watching nothing".
  const decodeCredentials = Schema.decodeUnknownOption(Credentials)
  const decodeWatching = Schema.decodeUnknownOption(Schema.Array(Crn))

  const get = storage(() => browser.storage.local.get(STORAGE_KEYS)).pipe(
    Effect.map((saved) =>
      Option.map(decodeCredentials(saved), (credentials): Account => ({
        credentials,
        watching: Option.getOrElse(decodeWatching(saved.watching), () => [])
      }))
    )
  )

  const save = Effect.fn("AccountStore.save")(function*(credentials: Credentials) {
    const saved = yield* get
    const sameAccount = Option.isSome(saved) && saved.value.credentials.email === credentials.email
    yield* storage(() =>
      browser.storage.local.set({
        email: credentials.email,
        pin: credentials.pin,
        // One account's classes must never show as another's.
        ...(sameAccount ? {} : { watching: [] })
      })
    )
  })

  const clear = storage(() => browser.storage.local.remove(STORAGE_KEYS))

  const updateWatching = Effect.fn("AccountStore.updateWatching")(function*(
    update: (watching: ReadonlyArray<Crn>) => ReadonlyArray<Crn>
  ) {
    const saved = yield* get
    if (Option.isSome(saved)) {
      const watching = update(saved.value.watching)
      yield* storage(() => browser.storage.local.set({ watching }))
    }
  })

  // `Stream.callback` turns a listener-style browser API into a stream: we
  // push a "something changed" signal into `queue`, and the stream emits it.
  const changeSignals = Stream.callback<void>(Effect.fn(function*(queue) {
    const onChanged = (changed: Record<string, unknown>) => {
      if (STORAGE_KEYS.some((key) => key in changed)) {
        Queue.offerUnsafe(queue, undefined)
      }
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
  return { get, save, clear, updateWatching, changes }
}

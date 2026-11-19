/**
 * Where the signed-in user's email and PIN are kept: the browser's extension
 * storage (`chrome.storage.local`). The popup and the content script both read
 * it, which is how signing in from one is seen by the other.
 */
import { Context, Effect, Layer, type Option, Queue, Schema, Stream } from "effect"
import { browser } from "wxt/browser"
import { Credentials, StorageError } from "./domain"

/**
 * The storage keys. Version 1 of the extension used the same two, so people
 * who signed in with it stay signed in. Do not rename them.
 */
const STORAGE_KEYS = ["email", "pin"]

export class CredentialStore extends Context.Service<CredentialStore, {
  /** The saved credentials, or `Option.none()` when nobody is signed in. */
  readonly get: Effect.Effect<Option.Option<Credentials>, StorageError>
  save(credentials: Credentials): Effect.Effect<void, StorageError>
  /** Forget the saved credentials (sign out on this browser). */
  readonly clear: Effect.Effect<void, StorageError>
  /**
   * A stream of the saved credentials: the current value straight away, then
   * a new value every time they change, including changes made elsewhere in
   * the extension (signing in from the popup updates the page, and back).
   */
  readonly watch: Stream.Stream<Option.Option<Credentials>, StorageError>
}>()("getthedamclass/CredentialStore") {
  /** The real implementation. Tests use it too, with WXT's in-memory `browser`. */
  static readonly layer = Layer.succeed(CredentialStore, makeCredentialStore())
}

function makeCredentialStore(): CredentialStore["Service"] {
  // Anything that is not a valid email and PIN counts as "not signed in".
  const decodeSaved = Schema.decodeUnknownOption(Credentials)

  const get = Effect.tryPromise({
    try: () => browser.storage.local.get(STORAGE_KEYS),
    catch: (cause) => new StorageError({ cause })
  }).pipe(Effect.map(decodeSaved))

  const save = (credentials: Credentials) =>
    Effect.tryPromise({
      try: () => browser.storage.local.set({ email: credentials.email, pin: credentials.pin }),
      catch: (cause) => new StorageError({ cause })
    })

  const clear = Effect.tryPromise({
    try: () => browser.storage.local.remove(STORAGE_KEYS),
    catch: (cause) => new StorageError({ cause })
  })

  // `Stream.callback` turns a listener-style browser API into a stream: we
  // push a "something changed" signal into `queue`, and the stream emits it.
  const changeSignals = Stream.callback<void>(Effect.fn(function*(queue) {
    const onChanged = (changes: Record<string, unknown>) => {
      if (STORAGE_KEYS.some((key) => key in changes)) {
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

  // For every signal, read the credentials again.
  const watch = changeSignals.pipe(Stream.mapEffect(() => get))

  // A plain object rather than `CredentialStore.of(...)`: this function is
  // called while the class above is still being defined.
  return { get, save, clear, watch }
}

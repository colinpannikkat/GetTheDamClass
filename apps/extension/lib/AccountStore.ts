// Each watched class is a key of its own, so adding or removing one never reads the list and two changes
// at once cannot undo each other. An answer is saved under the account that asked, whoever is signed in now.
import { EmailAddress } from "@getthedamclass/shared/domain"
import { Clock, Context, Duration, Effect, Layer, Option, Queue, Schema, Stream } from "effect"
import { browser } from "wxt/browser"
import { type ClassId, StorageError } from "./domain"

export interface Account {
  readonly email: EmailAddress
  readonly token: string
  // As far as this browser knows: only `listAlerts` (when the popup opens) syncs the whole list.
  readonly watching: ReadonlyArray<ClassId>
}

export interface CodeRequest {
  readonly email: EmailAddress
  readonly requestedAt: number
}

export type Saved =
  & (
    | ({ readonly status: "signedIn" } & Account)
    | {
      readonly status: "signedOut"
      readonly email: EmailAddress | undefined
    }
  )
  & {
    readonly codeRequest: CodeRequest | undefined
  }

// The server's rule (`CODE_LIFETIME` in apps/server/src/signIn.ts): keep the two equal.
const CODE_LIFETIME = Duration.minutes(15)

const WATCH_PREFIX = "watch:"

const watchKey = (email: EmailAddress, { term, crn }: ClassId) => `${WATCH_PREFIX}${term}:${email}:${crn}`

const parseWatchKey = (key: string): Option.Option<{ readonly email: string; readonly classId: ClassId }> =>
  Option.map(
    Option.fromNullishOr(key.match(/^watch:(\d{6}):(.+):(\d+)$/)),
    ([, term, email, crn]) => ({ email: email!, classId: { term: term!, crn: crn! } })
  )

export class AccountStore extends Context.Service<AccountStore, {
  readonly get: Effect.Effect<Saved, StorageError>
  save(email: EmailAddress, token: string): Effect.Effect<void, StorageError>
  // The classes go too: the account may be gone, and a new one for the same address would show them as
  // "Watching". A token that is no longer the saved one is left alone.
  forgetToken(token: string): Effect.Effect<void, StorageError>
  readonly clear: Effect.Effect<void, StorageError>
  saveCodeRequest(request: CodeRequest): Effect.Effect<void, StorageError>
  replaceCodeRequest(expected: CodeRequest, next: CodeRequest | undefined): Effect.Effect<boolean, StorageError>
  readonly forgetCodeRequest: Effect.Effect<void, StorageError>
  watch(email: EmailAddress, classes: ReadonlyArray<ClassId>): Effect.Effect<void, StorageError>
  unwatch(email: EmailAddress, classes: ReadonlyArray<ClassId>): Effect.Effect<void, StorageError>
  readonly changes: Stream.Stream<Saved, StorageError>
}>()("getthedamclass/AccountStore") {
  static readonly layer = Layer.effect(AccountStore, removeOldServersData().pipe(Effect.as(makeAccountStore())))
}

// Declarations, not `const`s, because `AccountStore`'s static field above uses them while the class is defined.

function storage<A>(call: () => Promise<A>) {
  return Effect.tryPromise({ try: call, catch: (cause) => new StorageError({ cause }) })
}

function makeAccountStore(): AccountStore["Service"] {
  const decodeEmail = Schema.decodeUnknownOption(EmailAddress)
  const decodeToken = Schema.decodeUnknownOption(Schema.NonEmptyString)
  const decodeCodeRequest = Schema.decodeUnknownOption(
    Schema.Struct({ email: EmailAddress, requestedAt: Schema.Number })
  )

  const forgetCodeRequest = storage(() => browser.storage.local.remove("codeRequest"))

  const get = Effect.gen(function*() {
    const saved = yield* storage(() => browser.storage.local.get())
    const now = yield* Clock.currentTimeMillis
    const email = decodeEmail(saved.email)
    const token = decodeToken(saved.token)
    const request = decodeCodeRequest(saved.codeRequest)
    const expired = Option.filter(request, (request) => now >= request.requestedAt + Duration.toMillis(CODE_LIFETIME))
    if (Option.isSome(expired)) {
      yield* forgetCodeRequest
    }
    const codeRequest = Option.isSome(expired) ? undefined : Option.getOrUndefined(request)

    if (Option.isSome(email) && Option.isSome(token)) {
      const watching = Object.keys(saved).flatMap((key) =>
        Option.match(parseWatchKey(key), {
          onNone: () => [],
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

  const changeSignals = Stream.callback<void>(Effect.fn(function*(queue) {
    const onChanged = () => {
      Queue.offerUnsafe(queue, undefined)
    }
    yield* Effect.acquireRelease(
      Effect.sync(() => browser.storage.local.onChanged.addListener(onChanged)),
      () => Effect.sync(() => browser.storage.local.onChanged.removeListener(onChanged))
    )
    Queue.offerUnsafe(queue, undefined)
  }))

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

function removeOldServersData() {
  return storage(async () => {
    const saved = await browser.storage.local.get()
    if ("pin" in saved) {
      await browser.storage.local.remove(["pin", ...Object.keys(saved).filter((key) => key.startsWith(WATCH_PREFIX))])
    }
  }).pipe(Effect.ignore)
}

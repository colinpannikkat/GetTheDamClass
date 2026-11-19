/**
 * The toolbar popup. Top to bottom:
 *
 *   App        picks a screen from who is signed in
 *   SignedOut  what the extension does, and the sign-in form
 *   SignedIn   who is signed in, and their classes (or why they did not load)
 *   Brand      the icon and name at the top of both screens
 *
 * The list of classes itself is in `ClassList.tsx`, and "Delete my account"
 * in `DeleteAccount.tsx`.
 */
import { useState } from "react"
import { Button } from "@/components/Button"
import { Message } from "@/components/Message"
import { SignInForm } from "@/components/SignInForm"
import type { CodeRequest } from "@/lib/AccountStore"
import { errorMessage } from "@/lib/errorMessage"
import { useAccount, useAction, useQuery } from "@/lib/react"
import { listAlerts, signOut } from "@/lib/workflows"
import { ClassList, ClassListSkeleton } from "./ClassList"
import { DeleteAccount } from "./DeleteAccount"

/** What the student just did here, said once on the signed-out screen that follows. */
type Farewell = "signedOut" | "deleted"

export function App() {
  // Updates by itself, so signing in or out switches the screen.
  const account = useAccount()
  const [farewell, setFarewell] = useState<Farewell | null>(null)
  return (
    // `w-90` is 360px. The height follows the content; Chrome sizes the popup to fit.
    <main className="ui-root flex w-90 flex-col">
      {/* Reading the saved sign-in takes a few milliseconds: show nothing rather than a flash. */}
      {account.status === "loading" && <div className="h-24" aria-busy="true" />}
      {account.status === "signedOut" && (
        <SignedOut email={account.email} codeRequest={account.codeRequest} farewell={farewell} />
      )}
      {account.status === "signedIn" && <SignedIn email={account.email} onLeft={setFarewell} />}
      <Message tone="error" className="m-4">
        {account.status === "failure" ? "Couldn't read your saved sign-in. Close this popup and open it again." : null}
      </Message>
      <footer className="border-t border-line px-4 py-2 text-center text-xs text-ink-muted">© 2024 Nothing Suspicious</footer>
    </main>
  )
}

function SignedOut({ email, codeRequest, farewell }: {
  /** What the sign-in form starts from: the last address, and a code asked for and not used yet. */
  readonly email: string | undefined
  readonly codeRequest: CodeRequest | undefined
  readonly farewell: Farewell | null
}) {
  return (
    <section className="flex flex-col gap-4 p-4">
      <Brand />
      {farewell === null && (
        <p className="text-ink-muted">
          Pick a class at Oregon State and get an email when a seat opens or the class fills up.
        </p>
      )}
      {farewell === "signedOut" && (
        // Signing out leaves the account and its alerts on the server. Say
        // so, or the emails that keep coming would be a surprise.
        <Message>
          Your alerts keep running: to stop one, sign in again and press Stop, or use the link in any email about it.
        </Message>
      )}
      {farewell === "deleted" && (
        <Message tone="success">Your account and all its alerts are deleted.</Message>
      )}
      <SignInForm email={email} codeRequest={codeRequest} />
    </section>
  )
}

/** `useAction` wants a function; `signOut` is an effect that takes no arguments. */
const runSignOut = () => signOut

function SignedIn({ email, onLeft }: {
  readonly email: string
  /** The student signed out or deleted the account here. */
  readonly onLeft: (farewell: Farewell) => void
}) {
  // Loads when the popup opens, and again if another account signs in.
  const { state, reload } = useQuery(() => listAlerts, [email])
  const signOutAction = useAction(runSignOut)

  // `NotSignedIn` is left out: the server no longer accepts the saved sign-in,
  // so the workflow has signed this browser out, and the sign-in form is about
  // to take this screen's place.
  const loadError = state.status === "failure" && state.error._tag !== "NotSignedIn" ? state.error : null
  const signOutError = signOutAction.state.status === "failure" ? signOutAction.state.error : null

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Brand detail={email} />
        <Button
          variant="quiet"
          size="sm"
          className="-mr-2"
          loading={signOutAction.state.status === "loading"}
          onClick={async () => {
            const result = await signOutAction.run()
            if (result.status === "success") {
              onLeft("signedOut")
            }
          }}
        >
          Sign out
        </Button>
      </header>

      <section className="flex flex-col gap-3 p-4" aria-busy={state.status === "loading"}>
        {/* Each <Message> stays on the page, empty, so that a screen reader announces its text when it appears. */}
        <Message tone="error">{signOutError && errorMessage(signOutError)}</Message>

        {state.status === "loading" && <ClassListSkeleton />}
        {state.status === "success" && <ClassList alerts={state.value} />}

        <Message tone="error">{loadError && errorMessage(loadError)}</Message>
        {loadError && (
          <Button className="self-start" onClick={reload}>
            Try again
          </Button>
        )}
      </section>

      <section className="flex flex-col border-t border-line px-4 py-2">
        <DeleteAccount onDeleted={() => onLeft("deleted")} />
      </section>
    </>
  )
}

/** The icon and the name, with an optional second line (the signed-in email). */
function Brand({ detail }: { readonly detail?: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      {/* The icon is drawn in dark ink, so it sits on a white tile to stay visible in dark mode. */}
      <img src="/icons/icon128.png" alt="" className="size-9 shrink-0 rounded-md border border-line bg-white p-1" />
      <div className="min-w-0">
        <h1 className="font-semibold">GetTheDamClass</h1>
        {detail && (
          // `truncate` cuts a long email with "…"; `title` shows all of it on hover.
          <p className="truncate text-xs text-ink-muted" title={detail}>
            {detail}
          </p>
        )}
      </div>
    </div>
  )
}

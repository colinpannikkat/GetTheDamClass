/**
 * The toolbar popup. Top to bottom:
 *
 *   App        picks a screen from who is signed in
 *   SignedOut  what the extension does, and the sign-in form
 *   SignedIn   who is signed in, and their classes (or why they did not load)
 *   Brand      the icon and name at the top of both screens
 *
 * The list of classes itself is in `ClassList.tsx`.
 */
import { useState } from "react"
import { Button } from "@/components/Button"
import { Message } from "@/components/Message"
import { SignInForm } from "@/components/SignInForm"
import { errorMessage } from "@/lib/errorMessage"
import { useAccount, useAction, useQuery } from "@/lib/react"
import { listSubscriptions, signOut } from "@/lib/workflows"
import { ClassList, ClassListSkeleton } from "./ClassList"

export function App() {
  // Updates by itself, so signing in or out switches the screen.
  const account = useAccount()
  const [signedOutHere, setSignedOutHere] = useState(false)
  return (
    // `w-90` is 360px. The height follows the content; Chrome sizes the popup to fit.
    <main className="ui-root flex w-90 flex-col">
      {/* Reading the saved sign-in takes a few milliseconds: show nothing rather than a flash. */}
      {account.status === "loading" && <div className="h-24" aria-busy="true" />}
      {account.status === "signedOut" && <SignedOut afterSigningOut={signedOutHere} />}
      {account.status === "signedIn" && (
        <SignedIn email={account.credentials.email} onSignedOut={() => setSignedOutHere(true)} />
      )}
      <Message tone="error" className="m-4">
        {account.status === "failure" ? "Couldn't read your saved sign-in. Close this popup and open it again." : null}
      </Message>
      <footer className="border-t border-line px-4 py-2 text-center text-xs text-ink-muted">© 2024 Nothing Suspicious</footer>
    </main>
  )
}

function SignedOut({ afterSigningOut }: { readonly afterSigningOut: boolean }) {
  return (
    <section className="flex flex-col gap-4 p-4">
      <Brand />
      {afterSigningOut
        ? (
          // Signing out only makes this browser forget the account. Say so,
          // or the emails that keep coming would be a surprise.
          <Message>
            Your alerts keep running: to stop one, sign in again and press Stop, or use the Unsubscribe button in its
            confirmation email.
          </Message>
        )
        : (
          <p className="text-ink-muted">
            Pick a class at Oregon State and get an email when a seat opens or the class fills up.
          </p>
        )}
      <SignInForm />
    </section>
  )
}

/** `useAction` wants a function; `signOut` is an effect that takes no arguments. */
const runSignOut = () => signOut

function SignedIn({ email, onSignedOut }: { readonly email: string; readonly onSignedOut: () => void }) {
  // Loads when the popup opens, and again if another account signs in.
  const { state, reload } = useQuery(() => listSubscriptions, [email])
  const signOutAction = useAction(runSignOut)

  const loadError = state.status === "failure" ? state.error : null
  // The server no longer accepts the saved email and PIN. Asking for them
  // again fixes that; "Try again" would only fail the same way.
  const mustSignInAgain = loadError?._tag === "WrongPin"
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
              onSignedOut()
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
        {state.status === "success" && <ClassList subscriptions={state.value} />}

        <Message tone="error">{loadError && !mustSignInAgain ? errorMessage(loadError) : null}</Message>
        {loadError && !mustSignInAgain && (
          <Button className="self-start" onClick={reload}>
            Try again
          </Button>
        )}

        <Message>{mustSignInAgain ? "Your saved PIN no longer works. Sign in again to see your classes." : null}</Message>
        {mustSignInAgain && <SignInForm email={email} onSignedIn={reload} />}
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

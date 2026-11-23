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

type Farewell = "signedOut" | "deleted"

export function App() {
  const account = useAccount()
  const [farewell, setFarewell] = useState<Farewell | null>(null)
  return (
    <main className="ui-root flex w-90 flex-col">
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

function SignedIn({ email, onLeft }: {
  readonly email: string
  readonly onLeft: (farewell: Farewell) => void
}) {
  const { state, reload } = useQuery(() => listAlerts(), [email])
  const signOutAction = useAction(signOut)

  // `NotSignedIn` is left out: the workflow has already signed this browser out, and the sign-in
  // form is about to replace this screen.
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

function Brand({ detail }: { readonly detail?: string }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <img src="/icons/icon128.png" alt="" className="size-9 shrink-0 rounded-md border border-line bg-white p-1" />
      <div className="min-w-0">
        <h1 className="font-semibold">GetTheDamClass</h1>
        {detail && (
          <p className="truncate text-xs text-ink-muted" title={detail}>
            {detail}
          </p>
        )}
      </div>
    </div>
  )
}

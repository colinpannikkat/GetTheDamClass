// Placeholder popup. It only proves that the pieces fit together: stored
// credentials, the sign-in form, a query and an action. The real popup
// replaces this file.
import { Button } from "@/components/Button"
import { Message } from "@/components/Message"
import { SignInForm } from "@/components/SignInForm"
import { subscriptionLabel } from "@/lib/domain"
import { errorMessage } from "@/lib/errorMessage"
import { useAction, useCredentials, useQuery } from "@/lib/react"
import { listSubscriptions, signOut } from "@/lib/workflows"

export function App() {
  const session = useCredentials()
  return (
    <main className="ui-root flex w-90 flex-col gap-4 p-4">
      <h1 className="text-base font-semibold">GetTheDamClass</h1>
      {session.status === "loading" && <p className="text-ink-muted">Loading…</p>}
      {session.status === "failure" && <Message tone="error">{errorMessage(session.error)}</Message>}
      {session.status === "signedOut" && <SignInForm />}
      {session.status === "signedIn" && <SignedIn email={session.credentials.email} />}
    </main>
  )
}

function SignedIn({ email }: { readonly email: string }) {
  const subscriptions = useQuery(() => listSubscriptions, [email])
  const signOutAction = useAction(() => signOut)
  return (
    <>
      <p className="text-ink-muted">Signed in as {email}</p>
      {subscriptions.state.status === "loading" && <p className="text-ink-muted">Loading your classes…</p>}
      {subscriptions.state.status === "failure" && (
        <Message tone="error">{errorMessage(subscriptions.state.error)}</Message>
      )}
      {subscriptions.state.status === "success" && (
        <ul className="flex flex-col gap-1">
          {subscriptions.state.value.map((subscription) => (
            <li key={subscription.crn}>{subscriptionLabel(subscription)}</li>
          ))}
        </ul>
      )}
      <Button variant="quiet" size="sm" onClick={() => signOutAction.run()}>
        Sign out
      </Button>
    </>
  )
}

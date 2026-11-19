/**
 * "Delete my account", at the bottom of the signed-in popup.
 *
 * Hard to press by accident: a small link, and then a box that says what
 * deleting does, where "Delete account" has to be pressed as well. The
 * keyboard lands on "Cancel" in that box, so a second Enter does nothing
 * harmful.
 */
import { useId, useState } from "react"
import { Button } from "@/components/Button"
import { Message } from "@/components/Message"
import { errorMessage } from "@/lib/errorMessage"
import { useAction } from "@/lib/react"
import { deleteAccount } from "@/lib/workflows"

export function DeleteAccount({ onDeleted }: {
  /** The account is gone, and so is everything this browser saved. */
  readonly onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const { state, run } = useAction(deleteAccount)
  const questionId = useId()

  if (!confirming) {
    return (
      <Button variant="quiet" size="sm" className="-ml-3 self-start" onClick={() => setConfirming(true)}>
        Delete my account
      </Button>
    )
  }

  async function handleDelete() {
    const result = await run()
    if (result.status === "success") {
      onDeleted()
    }
  }

  return (
    <div role="group" aria-labelledby={questionId} className="flex flex-col gap-3 rounded-lg border border-danger p-3">
      <p id={questionId}>
        Delete your account? This stops all your alerts and signs you out everywhere. It can't be undone.
      </p>
      <Message tone="error">{state.status === "failure" ? errorMessage(state.error) : null}</Message>
      <div className="flex gap-2">
        <Button variant="danger" size="sm" loading={state.status === "loading"} onClick={handleDelete}>
          Delete account
        </Button>
        <Button size="sm" autoFocus onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

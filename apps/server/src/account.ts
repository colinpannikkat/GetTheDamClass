/**
 * The `account` endpoints of the API: signing out, and deleting the account.
 */
import { Api, SignedIn } from "@getthedamclass/shared/Api"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/http-api"
import { SqlClient } from "effect/sql"
import { dieOnSqlError } from "./database"
import { endToken } from "./tokens"

/**
 * Delete an account. The database removes its alerts and every one of its
 * tokens with it (`ON DELETE CASCADE` in migrations/), so every browser it was
 * signed in on is signed out.
 */
export const deleteAccount = Effect.fn("deleteAccount")(function*(accountId: number) {
  const sql = yield* SqlClient.SqlClient
  yield* sql`DELETE FROM accounts WHERE id = ${accountId}`
}, dieOnSqlError)

export const AccountHandlers = HttpApiBuilder.group(Api, "account", (handlers) =>
  handlers
    .handle("signOut", () => SignedIn.use((signedIn) => endToken(signedIn.tokenId)))
    .handle("deleteAccount", () => SignedIn.use((signedIn) => deleteAccount(signedIn.accountId))))

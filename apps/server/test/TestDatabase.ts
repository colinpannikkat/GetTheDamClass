import { SqliteClient } from "@effect/sql-sqlite-node"
import { Effect, Layer } from "effect"
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"

const MIGRATIONS = join(import.meta.dirname, "..", "migrations")

// `node:sqlite` directly, because a migration holds many statements and `SqlClient` runs one at a time.
const migrate = (filename: string) => {
  const db = new DatabaseSync(filename)
  try {
    for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
      db.exec(readFileSync(join(MIGRATIONS, file), "utf8"))
    }
  } finally {
    db.close()
  }
}

export const TestDatabase = Layer.unwrap(
  Effect.gen(function*() {
    const folder = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "getthedamclass-test-"))),
      (folder) => Effect.sync(() => rmSync(folder, { recursive: true, force: true }))
    )
    const filename = join(folder, "test.sqlite")
    migrate(filename)
    return SqliteClient.layer({ filename })
  })
)

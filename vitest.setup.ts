// Runs before every test file (see vitest.config.ts).
//
// The DOM used in tests (happy-dom) does not load pages into <iframe>s, and
// prints an error with a stack trace every time one is added to the page. Our
// sign-in frame is supposed to stay empty in tests (its page has tests of its
// own), so that one message is dropped here to keep the test output readable.
//
// happy-dom writes to Node's own console rather than the one Vitest gives the
// tests, which is why this patches `node:console`.
import nodeConsole from "node:console"

const printError = nodeConsole.error
nodeConsole.error = (...args: Array<unknown>) => {
  if (!String(args[0]).includes("Iframe page loading is disabled")) {
    printError(...args)
  }
}

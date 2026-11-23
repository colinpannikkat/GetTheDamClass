// happy-dom logs an error for every <iframe> it cannot load, and our sign-in frame stays empty in
// tests on purpose. It logs to Node's own console, hence `node:console`.
import nodeConsole from "node:console"

const printError = nodeConsole.error
nodeConsole.error = (...args: Array<unknown>) => {
  if (!String(args[0]).includes("Iframe page loading is disabled")) {
    printError(...args)
  }
}

// Unlike Chrome, the fake storage reports a change even for a write that leaves the value as it
// was: code must not wait for a storage change to learn that something was done.

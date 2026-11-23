# Extension

The Chrome extension: a "Notify me" button on [classes.oregonstate.edu](https://classes.oregonstate.edu) and a toolbar popup. Setup is in the [main README](../../README.md#develop).

## Commands

Run these in `apps/extension`.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Builds into `.output/chrome-mv3-dev`, then rebuilds and reloads as you edit. Talks to the local server. |
| `pnpm build` | Production build into `.output/chrome-mv3`. Talks to the real server. |
| `pnpm build:local` | The production build, but talking to the local server, into `.output/chrome-mv3-local-server`. |
| `pnpm zip` | Builds, then packs a zip into `.output/` for a release. |
| `pnpm typecheck` | Checks the TypeScript types. |
| `pnpm test` | Runs the unit tests. |

The local server is `http://localhost:5173` ([apps/server](../server/README.md)). Since Chrome 142, a website needs your permission to reach your own computer, and the content script's requests count as coming from classes.oregonstate.edu. So Chrome asks the first time you press "Notify me"; choose **Allow**. If you blocked it, the button says "Couldn't reach the server": allow it again from the icon left of the address bar.

## Files

```
entrypoints/            What the browser loads.
  popup/                The window that opens from the toolbar icon.
  content/              The script added to classes.oregonstate.edu.
    index.tsx           Puts a control into every class-details panel and keeps it there.
    detailsPanel.ts     Everything we know about the page's HTML.
    NotifyControl.tsx   "Notify me", "Stop alerts", their messages and the sign-in popover.
    fixtures/           Trimmed copies of the real page, for the tests.
  signin/               The sign-in form the class page shows in a frame.
components/             React components shared by the popup and the pages above.
lib/                    Everything that is not user interface.
  Api.ts                Service: the calls to the server.
  AccountStore.ts       Service: what is saved in the browser's extension storage.
  workflows.ts          What a user can do: requestCode, signIn, subscribe, unsubscribe, ...
  runtime.ts            Wires the real services together so effects can run.
  react.ts              Hooks that let React components run effects.
  errorMessage.ts       The sentence shown to the user for each error.
  domain.ts             ClassId, and the errors only the extension has.
wxt.config.ts           Extension name, permissions and icons.
```

## What is stored in the browser

The popup, the button on the class page and the sign-in frame all read and write the extension's storage, and each follows it as it changes. So signing in anywhere signs you in everywhere, and stopping an alert in the popup turns "Watching" back into "Notify me" on an open class page.

Everything is stored unencrypted, and removed when you sign out or delete your account.

| Key | Value | Meaning |
| --- | --- | --- |
| `email` | `"student@oregonstate.edu"` | Who is signed in. Without a `token`, the address the sign-in form starts with. |
| `token` | `"kq3V..."` | The sign-in token, sent with every request as `Authorization: Bearer`. |
| `codeRequest` | `{ "email": "...", "requestedAt": 1795075200000 }` | A code was asked for at this time and not used yet. |
| `watch:202702:student@oregonstate.edu:33940` | `true` | One key per watched class: term, account, CRN. |

Why it is shaped this way:

- **`codeRequest`** lets the form survive being closed. Chrome closes the popup when you click into your inbox, and the form reopens at the code step. It is saved before the server is asked, since the popup is often gone before the answer comes, and undone if the server refuses while the form is still open (`requestCode` in `lib/workflows.ts`). It lasts 15 minutes, as long as a code works.
- **One key per class** makes adding and removing single writes, so changes to two classes at the same moment cannot undo each other.
- **The account is in the key** so that an answer arriving after someone else signed in is saved for the account that asked.
- **The term is in the key** because the university reuses CRNs from term to term.
- **`NotSignedIn` from the server** (the account was deleted elsewhere, or the token went unused for a year) removes `token` and that account's `watch:` keys and keeps `email`, so the sign-in form shows with the address filled in.
- **Signing out** clears the browser first and only then tells the server, giving it 5 seconds, so it works with the server down.
- **Updating from version 1** removes its `pin` key and old `watch:` keys the first time the extension starts (`AccountStore.layer`). The email stays.

The class page trusts the saved list and does not ask the server. If an alert ended elsewhere (the link in an email, another browser, the server's cleanup after the add deadline), the page says "Watching" until the popup is next opened, which fetches the real list. "Stop alerts" works either way.

Known gaps, each needing two parts of the extension used within the time of one request:

- A "Notify me" still waiting when you sign out elsewhere saves its `watch:` key after the sign-out, where it stays until the next sign-out.
- Two changes to the same class: the answer saved last wins. Press "Notify me", then "Stop" in the popup before the first answer is back, and the page can say "Watching" until the popup is next opened.
- "Delete my account" clears the browser once the server has answered. A sign-in to another account made while it waits is cleared too.

## Why the sign-in form is in a frame

A web page's own scripts can read whatever a content script draws into it, including every key typed into a field. So the email and the code are never typed into the university's page. The popover that "Notify me" opens holds an `<iframe>` showing `signin.html`, a page of the extension that the class page cannot look inside. `wxt.config.ts` lists it under `web_accessible_resources` for classes.oregonstate.edu only.

The frame tells the page three things with `window.postMessage` (`entrypoints/signin/messages.ts`): "close me", "I am this tall now" and "signed in". None carries what was typed. Only "signed in" from the form that was actually submitted makes the button go on to set up the alert. Signing in through the popup while a popover is open just closes the popover.

## When the university changes its page

The button is added only when the script can read the CRN, the term and the bar that holds ADD TO CART. If one is missing it shows nothing, rather than a button that might be for the wrong class. So after a change to the university's markup, the button disappears.

Every selector is in `entrypoints/content/detailsPanel.ts`, with a drawing of the page's structure at the top. To fix it:

1. Open a section on classes.oregonstate.edu and run `copy(document.querySelector("main.panels").outerHTML)` in the developer tools.
2. Paste that over a file in `entrypoints/content/fixtures/` and trim it the way the comment at its top describes.
3. Run `pnpm test` and fix `detailsPanel.ts` until it passes.

## How the Effect code is organised

- **Services** touch the outside world: `Api` (the server) and `AccountStore` (browser storage). Code asks for one with `const api = yield* Api`.
- **Layers** implement a service. `Api.layer` is the real one, on `fetch`. Tests swap in `Api.layerWithFetch(fakeFetch)` or `Layer.mock(Api, { ... })`.
- **The runtime** (`lib/runtime.ts`) puts the real layers together, once.
- **Errors** each have a `_tag`, so handling one is a `switch` on `error._tag`. The server's refusals are in `packages/shared/src/domain.ts` and carry a `message` written for the student. The extension's own errors are in `lib/domain.ts`, with their sentences in `lib/errorMessage.ts`.
- **Workflows** (`lib/workflows.ts`) combine the services into what a user does. The user interface calls workflows, never the services.
- **Hooks** (`lib/react.ts`) run effects from components and give back a `status` to switch on: `useAction(workflow)` for clicks and submits, `useQuery(() => effect, deps)` for loading data, and `useAccount()` for who is signed in and what they are watching.

### Adding a server call

1. Add the endpoint to `packages/shared/src/Api.ts`, any new refusal to `packages/shared/src/domain.ts`, and implement it in `apps/server`.
2. Add a function to the `Api` service in `lib/Api.ts`, with `settle` as its last step like the others.
3. Cover it in `lib/Api.test.ts`: the request it sends, each refusal, and a reply of the wrong shape.
4. Add a workflow in `lib/workflows.ts`. If it sends the token, wrap the call in `withToken`, so that `NotSignedIn` signs the browser out.
5. Add a new refusal to `AppError` in `lib/domain.ts` and to the list in `lib/errorMessage.ts`.
6. Call it from a component with `useAction` or `useQuery`.

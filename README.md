# GetTheDamClass

Class vacancy notifier Chrome extension for Oregon State University.

On [classes.oregonstate.edu](https://classes.oregonstate.edu), open a class and press **Notify me**: you get an email when a seat opens up. The toolbar popup lists the classes you are watching and lets you stop the alerts.

We have a backend server running on a private VPS to track course vacancies and alert students. The backend code can be found [here](https://github.com/aj-arts/GetTheDamClass-Backend).

## Adding the Chrome Extension

1. Download the latest release from the [releases page](https://github.com/aj-arts/GetTheDamClass/releases).
2. Extract the downloaded zip file to a location on your local machine.
3. Open Chrome and navigate to `chrome://extensions`.
4. Enable "Developer mode" by toggling the switch in the top right corner.
5. Click on the "Load unpacked" button and select the extracted folder.
6. The extension should now be added to Chrome and ready to use.

We will hopefully have it released on the Chrome Web Store soon!

## Building it yourself

You need [Node.js](https://nodejs.org) 22.12 or newer (developed with 24).

```sh
npm install
npm run build
```

The extension is written to **`.output/chrome-mv3`**. Load that folder in Chrome: `chrome://extensions` → enable "Developer mode" → "Load unpacked".

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development build into `.output/chrome-mv3-dev` that rebuilds and reloads as you edit. Load that folder once with "Load unpacked". (It asks for extra permissions that WXT needs for reloading; the real build does not.) |
| `npm run build` | Production build into `.output/chrome-mv3`. |
| `npm run zip` | Builds, then packs the result into a zip in `.output/` for a release or the Chrome Web Store. |
| `npm run typecheck` | Checks the TypeScript types. |
| `npm test` | Runs the unit tests. |

## How it is built

- [WXT](https://wxt.dev) builds the extension and generates `manifest.json` (from `wxt.config.ts` and the files in `entrypoints/`).
- [React](https://react.dev) and [Tailwind CSS](https://tailwindcss.com) draw the user interface.
- [Effect](https://effect.website) runs everything that is not drawing: talking to the backend, storage, and error handling.
- [Vitest](https://vitest.dev) runs the tests. They sit next to the file they test (`Api.ts` → `Api.test.ts`).

## Project map

```
entrypoints/            What the browser loads. WXT turns each folder into part of the extension.
  popup/                The window that opens from the toolbar icon.
  content/              The script added to classes.oregonstate.edu.
components/             React components shared by the popup and the page.
  Button.tsx            A button with variants and a loading state.
  Message.tsx           An inline info, success or error message.
  TextField.tsx         A text input with its label.
  SignInForm.tsx        Email + PIN form that signs in (or signs up).
  cx.ts                 Tiny helper to join CSS class names.
lib/                    Everything that is not user interface.
  domain.ts             The data types (Credentials, Crn, Subscription) and every error.
  Api.ts                Service: the calls to the backend.
  CredentialStore.ts    Service: the saved email and PIN, in the browser's extension storage.
  workflows.ts          What a user can do: signIn, signOut, subscribe, unsubscribe, listSubscriptions.
  runtime.ts            Wires the real services together so effects can run.
  react.ts              Hooks that let React components run effects.
  errorMessage.ts       The sentence shown to the user for each error.
  parseCrn.ts           Finds the CRN in the text of the class page.
assets/tailwind.css     The stylesheet: colours and sizes used everywhere.
public/icons/           The extension's icons, copied into the build as they are.
wxt.config.ts           Extension name, permissions, icons; build plugins.
vitest.config.ts        Test setup.
```

There is no background script. The extension only needs the `storage` permission, and no access to any website beyond the content script on the class search.

## How the Effect code is organised

If you have not used Effect before, this is all you need to find your way around `lib/`.

**An effect is a description of work.** A value of type `Effect<Success, Error, Requirements>` does nothing by itself; it describes something that, when run, either succeeds with a `Success` or fails with one of the listed `Error`s. Because the errors are part of the type, TypeScript tells you which failures you still have to handle.

Inside `Effect.gen(function*() { ... })`, read `yield*` the way you read `await`: it runs another effect and gives you its result.

**Services** are the parts that touch the outside world. There are two:

- `Api` (`lib/Api.ts`) sends requests to the backend.
- `CredentialStore` (`lib/CredentialStore.ts`) reads and writes the saved email and PIN.

Each is a class that names the service and lists its functions. Code asks for one with `const api = yield* Api`.

**Layers** are the implementations of a service. `Api.layer` is the real one, built on `fetch`. Tests swap in others: `Api.layerWithFetch(fakeFetch)` to test the Api itself, or `Layer.mock(Api, { ... })` to give other code a fake backend.

**The runtime** (`lib/runtime.ts`) is where the real layers are put together, once. Anything that wants to run an effect uses it.

**Errors** are all defined in `lib/domain.ts`. Each has a `_tag`, its name as a string (`"WrongPin"`, `"AlreadySubscribed"`, `"NetworkError"`, ...), so handling an error is a `switch` on `error._tag`. `lib/errorMessage.ts` holds the sentence shown for each one.

**Workflows** (`lib/workflows.ts`) combine the services into the things a user does. `subscribe(crn)`, for example, reads the saved credentials (failing with `NotSignedIn` if there are none) and calls the backend with them. The user interface calls workflows, never the services directly.

**Components run effects through three hooks** in `lib/react.ts`. They turn an effect into a plain object with a `status` to switch on:

```tsx
import { Button } from "@/components/Button"
import { Message } from "@/components/Message"
import { errorMessage } from "@/lib/errorMessage"
import { useAction } from "@/lib/react"
import { subscribe } from "@/lib/workflows"

function NotifyButton({ crn }: { crn: string }) {
  const { state, run } = useAction(subscribe)
  return (
    <>
      <Button variant="primary" loading={state.status === "loading"} onClick={() => run(crn)}>
        Notify me
      </Button>
      <Message tone="success">{state.status === "success" ? "You're on the list." : null}</Message>
      <Message tone="error">{state.status === "failure" ? errorMessage(state.error) : null}</Message>
    </>
  )
}
```

- `useAction(workflow)` gives a `run` function for clicks and form submits.
- `useQuery(() => effect, deps)` runs an effect when the component appears, for loading data.
- `useCredentials()` says who is signed in, and updates when that changes anywhere in the extension.

### Adding a backend call

1. Add the function to the `Api` service in `lib/Api.ts`, mapping each HTTP status to a result or an error from `lib/domain.ts`.
2. Cover those statuses in `lib/Api.test.ts`.
3. Add a workflow in `lib/workflows.ts` if it needs the saved credentials.
4. Call it from a component with `useAction` or `useQuery`.

---
&copy; 2024 Nothing Suspicious (Colin Pannikkat, Ajinkya Gokule, David Gesl, Sarvesh Thiruppathi Ahila)

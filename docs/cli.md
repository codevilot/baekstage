# CLI reference

## Start a standalone workspace

```bash
npx baekstage
npx baekstage --open
npx baekstage --port 8790
npx baekstage --config ./config/baekstage.config.ts
```

The CLI loads TypeScript and JavaScript config through Vite, creates an isolated
temporary web root, and serves the published Baekstage viewer. Temporary files are
removed when the process receives `SIGINT` or `SIGTERM`.

## Configuration

```ts
import { defineConfig } from "baekstage/config";

export default defineConfig({
  envFile: ".env.baekstage",
  discovery: {
    root: "./tests/baekstage",
    exclude: ["postgres-data"],
    ignorePermissionErrors: true,
  },
  suite,
  playwright: {
    projectRoot: "./web-app",
    command: "npm",
    commandArgs: ["exec", "--", "playwright", "test"],
    env: { CI: "1", PLAYWRIGHT_PORT: "{port}" },
  },
  webServer: {
    port: "auto",
    command: "npm run dev -- --hostname 127.0.0.1 --port {port}",
    url: "http://127.0.0.1:{port}",
    reuseExistingServer: true,
    timeoutMs: 120_000,
  },
  services: {
    database: {
      command: "docker compose up postgres",
      url: "tcp://127.0.0.1:55432",
      reuseExistingServer: false,
    },
    api: {
      cwd: "./server",
      command: "npm run dev",
      url: "http://127.0.0.1:48080/health",
    },
  },
  results: ".baekstage/results",
  server: {
    host: "127.0.0.1",
    port: 4173,
    open: false,
  },
});
```

`suite` is optional when discovery finds at least one definition; configured and
discovered scenarios are combined. `playwright` is optional; without it the CLI is a
static graph viewer. General relative paths are resolved from the directory where
Baekstage is executed.

CLI host, port, and open flags override values in the config file.

`discovery.root` changes where scenario discovery starts. By default Baekstage finds
recursive legacy `*.baekstage.*` definitions and semantic `baekstage.scenario.*`
definitions:

```text
tests/baekstage/
  checkout/
    baekstage.scenario.ts
    baekstage.spec.ts
```

```ts
execution: {
  adapter: "playwright",
  source: "./baekstage.spec.ts",
}
```

Baekstage resolves `./` and `../` execution sources from the definition file. Override
`discovery.include` when a project needs another definition name; patterns support `*`,
`**`, and `?` and are relative to the discovery root. Keeping the definition and
executable test separate prevents scenario discovery from registering Playwright tests
in the viewer process. `baekstage.spec.*` is deliberately not a definition pattern.

`discovery.exclude` accepts directory names or paths relative to that root, and
`ignorePermissionErrors` skips directories that cannot be read due to permissions.
While the CLI is running, adding, editing, or removing a matching scenario definition
automatically refreshes the browser and runner catalog on the same server port. Invalid
intermediate edits are reported without replacing the last valid catalog; saving a valid
definition retries the refresh.

`envFile` loads dotenv-style values into managed services, the app server, and the
Playwright child only; it does not mutate the Baekstage process environment. Services
start in declaration order, accept HTTP(S) or TCP readiness URLs, and stop in reverse
order. Put `.env.baekstage` in `.gitignore` when it contains credentials.

`webServer` lets the CLI own the application server without a `.env` file. Baekstage
reuses a healthy server by default, otherwise starts `command`, waits for `url`, and
stops the process when Baekstage exits. `cwd` is relative to the directory where the
CLI is run. Command output is preserved when startup fails.

Set `port: "auto"` to keep managed app and service ports internal and conflict-free.
Baekstage replaces `{port}` in `command`, `url`, and `env` values, and also provides
`PORT` and `BAEKSTAGE_PORT` to that process. The resolved app address is passed to
Playwright as `BAEKSTAGE_WEB_SERVER_URL` and `BAEKSTAGE_WEB_SERVER_PORT`. Managed
services similarly expose `BAEKSTAGE_SERVICE_<NAME>_URL` and `_PORT`. Keep only the
Baekstage viewer's `server.port` fixed when one stable browser-facing port is needed.
`{port}` in `playwright.env` is also replaced with the resolved app-server port for
test suites that already use a project-specific variable such as `PLAYWRIGHT_PORT`.

Use this as the single owner of the application process. Remove `webServer` from the
Playwright config used by Baekstage so Playwright does not try to start the same app a
second time. No environment-variable handshake is required.

Config discovery supports both Storybook-style config names and short names:

```text
baekstage.config.ts
baekstage.config.js
baekstage.config.json
baekstage.js
baekstage.json
```

JavaScript config can import and compose a suite. JSON config contains the same object
shape directly. Neither format requires `.env`.

## Package scripts

An npm dependency cannot and should not edit a consumer's scripts automatically. Add
the script explicitly when a team wants a stable command:

```json
{
  "scripts": {
    "baekstage": "baekstage --config baekstage.config.ts"
  }
}
```

Then run `npm run baekstage`.

## Security

The local runner accepts an HTTP request that starts a configured Playwright process.
Bind to loopback unless the server is protected. Do not expose it publicly without
authentication, scenario authorization, concurrency limits, and process isolation.

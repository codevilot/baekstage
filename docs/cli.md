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
  suite,
  playwright: {
    projectRoot: "./web-app",
    command: "npm",
    commandArgs: ["exec", "--", "playwright", "test"],
    env: { CI: "1" },
  },
  results: ".baekstage/results",
  server: {
    host: "127.0.0.1",
    port: 4173,
    open: false,
  },
});
```

`suite` is required. `playwright` is optional; without it the CLI is a static graph
viewer. Relative paths are resolved from the directory where Baekstage is executed.

CLI host, port, and open flags override values in the config file.

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

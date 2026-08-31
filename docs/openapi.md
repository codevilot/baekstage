# OpenAPI sources

Register OpenAPI 3.x JSON or YAML documents in `baekstage.config.ts`:

```ts
export default defineConfig({
  sources: { openapi: [{
    id: "shop-api",
    title: "Shop API",
    file: "./openapi.yaml",
    baseUrl: "http://localhost:8080",
    environments: {
      Local: "http://localhost:8080",
      Staging: "https://api.staging.example.test",
    },
  }] },
  suite,
});
```

Baekstage extracts tags, methods, paths, parameters, request bodies, responses,
schemas, and examples. Every operation receives the stable reference
`openapi:<source-id>:<METHOD>:<path>`. Connect it to an API node with `ref`.

Catalog marks operations without a Scenario as **Unlinked · Untested**. A linked
operation remains **Untested** until its node has a result. Invalid sources appear in
Catalog as readable errors; they do not prevent valid sources from loading.

Local `$ref` values remain visible in schema output and are resolved for server-side
response validation when they point into the registered document.

## Response branches

Baekstage normalizes exact (`200`, `409`), range (`2XX`, `4XX`, `5XX`), and
`default` responses. Matching prefers exact, then range, then default. A documented
response is a possible branch, not an executable test case. It becomes reproducible
only when a Scenario API node defines a case with request/setup data.

Response validation runs on the local server with Ajv. The supported MVP surface is
`type`, `required`, `properties`, array `items`, `enum`, OpenAPI 3.0 `nullable`, local
`$ref`, `allOf`, `oneOf`, and `anyOf`. External `$ref` is never downloaded and is
reported as validation unsupported rather than passed.

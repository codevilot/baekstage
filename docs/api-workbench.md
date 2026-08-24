# API Workbench

Select an endpoint in Catalog, or select an OpenAPI-linked API node in Map. The side
panel keeps the Scenario context and pre-fills values from `node.request`.

Workbench supports path/query parameters, headers, JSON bodies, environment choice,
response status/headers/body, duration, redacted curl copying, and these assertions:

- HTTP status equality
- dot path or JSONPath-like (`$.status`) body equality
- required value existence
- maximum duration
- Content-Type inclusion

The request runs through the local Vite server, not directly from the browser. Its
result updates the API node status, duration, artifacts, and individual assertion
results in the current workspace. Replay results are stored by run ID under the
configured result directory. Request bodies and secret headers are deliberately not
written to those files.

Network failures (including timeout) are distinct from ordinary non-2xx responses.
Non-2xx responses remain inspectable and can be asserted explicitly.

## Documented branch, case, and observed result

- A documented branch comes from an OpenAPI response and may still be untested.
- A test case supplies the request and reproduction setup for an expected branch.
- An observed result is evidence from an API replay or an opted-in Playwright network attachment.

An expected `409` with passing assertions is a passed test even though its HTTP result
is an error response. Without an expected response, only 2xx is passed. Fixture,
Playwright, and external setup types are displayed but are not automatically executed.

## Observed and replay comparison

Observed Playwright runs and replay runs share node history but retain their origin.
Select either run independently. The comparison prioritizes status, branch, content
type, schema validity, duration, failure kind, and changed JSON fields. Large values are
limited to 100 displayed fields. If a request body was omitted, Workbench says `not
stored`; it does not reconstruct it from a configured case.

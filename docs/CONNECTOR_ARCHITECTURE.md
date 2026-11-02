# Connector architecture

The active path controls Telegram Desktop and ordinary Firefox for X and
Yandex Metrika. Platform connectors do not call service APIs or inspect account
sessions. DOM reads and same-origin SPA navigation are isolated in a Firefox
Web Console adapter; they do not enable a remote browser driver.

| Owner | Responsibility |
|---|---|
| `services/telegram/` | Telegram operation catalog and navigation rules |
| `services/x/` | X operation catalog, post identity, and bookmark interpretation |
| `services/metrika/` | Metrika catalog, section addresses, and settings interpretation |
| `services/interface/` | Shared UI operation contracts |
| `connectors.mjs` | Composition of public domain entries |
| `ui.mjs` | Actions based on fresh UIA observations |
| `executor.mjs`, `selectors.mjs` | Plan execution and observable conditions |
| `desktop.mjs`, `native.mjs` | Session and JSON-line bridge lifecycle |
| `native/` | Windows UIA, TextPattern, screenshots, physical input, credentials, runas |
| `connector-journal.mjs` | SQLite delivery receipts and uncertain-request handling |
| `jobs.mjs` | Durable task graph and persisted waits |
| `worker.mjs`, `supervisor.mjs` | Detached execution and recovery |
| `pages.mjs`, `firefox-console.mjs` | Page readiness, navigation, and extraction |
| `decisions.mjs` | Optional budget-limited selection of observed controls |
| `routines/` | Saved compositions of existing operations |
| `mcp.mjs`, CLI entries | Argument routing |

Domains take and return plain values. They do not import Windows, HTTP,
databases, or outer-layer modules. Call another domain through its public
`index.mjs`. Register services once in `connectors.mjs`; discovery, MCP schemas,
CLI usage, and architecture checks derive from that registry.

`scripts/architecture.mjs` enforces domain import boundaries, public entry points,
RULES files, unique operation names, and the absence of service network/driver
paths in active UI connectors. Platform-specific rules belong in their owner.

## Delivery and persistence

A mutation requires a request ID. A SQLite receipt is written before delivery.
Identical completed requests return their receipt; uncertain outcomes require
reconciliation. Ordinary UI input cannot provide exactly-once delivery at the
service boundary.

Durable connector nodes accept read-only operations or verified plans. Raw input
primitives return `unverified` and cannot stand in for a durable business result.
Graphs persist outputs and absolute wake-up times. Long waits release the native
process; short waits retain a warm accessibility provider. Cycles have a transition
limit; STOP and cancellation are checked between calls.

## Compatibility

Legacy `FirefoxClient`, browser nodes, and recipes remain for old direct imports
and saved jobs. New MCP/CLI submissions reject browser-driver nodes and do not
export `firefox_page`. These legacy modules are not the supported browser-control
path; do not use them to enable bot mode in new tasks.

The native mutex keeps its historical `MeSystemWindowsExecutorInput` name so an
older installation and a public clone cannot concurrently inject input.
Do not rename this lock independently in different bridge entry points.

External UI changes can require selector or route repairs. A catalog operation
does not mean that every installed application version or account supports it.

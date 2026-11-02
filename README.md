# Windows Executor

A local Windows UI executor using Node.js, Windows UI Automation, and native
Win32 input. The C# bridge uses the .NET Framework included with Windows.
The executor exposes a stdio MCP server and command-line tools.

## Requirements and installation

- Windows x64 with .NET Framework 4.x and an interactive desktop session.
- Node.js 24 or later and Git.
- Firefox for browser operations; Telegram Desktop for the Telegram connector.
- Windows 10 x64 has been exercised locally. Other Windows configurations need
  their own real-desktop verification; CI compilation is not GUI certification.

From the repository root:

```powershell
npm ci
npm run build
npm run verify
node src/cli.mjs selftest
node src/fast-cli.mjs windows
```

The first commands install dependencies and compile the native bridge. The last
two are read-only. Setup does not install a skill or start a background service.
See [installation](docs/INSTALLATION.md) for MCP configuration and optional steps.

## Reading and execution

Prefer `desktop_text` for browser text, bounded `desktop_observe` for controls,
and a screenshot for visual content. `desktop_page` combines navigation,
readiness checks, and saving. DOM/HTML reads use the ordinary Firefox Web Console
and clipboard. No service API, Marionette, WebDriver, or remote-debugging server
is used by the active UI connectors.

`desktop_sequence` batches already planned native actions. A delivered input is
not a verified outcome. A `desktop_plan` needs observable postconditions.
Frames are single-use; UIA references expire. User input, focus changes, and the
STOP file can interrupt execution. See [security](SECURITY.md).

```powershell
node src/connector-cli.mjs catalog telegram
node src/connector-cli.mjs catalog x
node src/connector-cli.mjs catalog metrika
```

The service owners are [Telegram](src/services/telegram/RULES.md),
[X](src/services/x/RULES.md), and [Yandex Metrika](src/services/metrika/RULES.md).
Catalog entries marked `observed_plan` require a plan built from current UI.
They are contracts for executing that plan, not prebuilt recipes for every
feature or claims of end-to-end coverage.

Mutating connector calls require a unique `requestId`. A repeated identical
request returns its receipt; a conflicting request with the same ID is rejected.
Inspect `connector_request` and the UI before resolving `started` or `uncertain`.
`completed` describes the call; `output.taskStatus` describes its verification.

## Credentials and administrator launches

`desktop_auth` accepts `env:NAME` or `wincred:TARGET` references, a fresh selector,
the observed window title, and the exact browser origin. Credential values must
not enter plans, screenshots, Git, or receipts. Password entry uses this dedicated
operation rather than ordinary text input.

`desktop_admin` requests Windows `runas`. UAC on the secure desktop needs the
user's consent. An accepted launch request is not evidence that the intended
application opened. An ordinary executor cannot control elevated windows.

## Durable tasks

`desktop_job` supports submit, status, list, cancel, and resume. A detached worker
stores its graph, journal, results, and wake-up time under `local/jobs/`.
Nodes include page, ui, desktop, connector, wait, sleep, branch, collect, and finish.
Wait conditions must be read-only. Uncertain changes are not blindly replayed.
`needs_decision` requires agent reasoning; the worker is not an independent
general-purpose visual agent.

Use one saved routine for repeated work. `routines/read-pages.mjs` builds a graph
for a series of pages. `routines/unbookmark-read.mjs` accepts an explicit list of
post URLs; it requires an observed Bookmarks page and verification after reload.
No example is run during installation or CI.

An optional Decisions client selects among already observed ambiguous controls.
It is disabled without `local/decisions.json`; basic UI use needs no API key.
See [performance and Decisions](docs/PERFORMANCE.md).

## Development

```powershell
npm run build
npm run verify
```

[Architecture](docs/CONNECTOR_ARCHITECTURE.md),
[verification scope](docs/VERIFICATION.md), and
[contribution rules](CONTRIBUTING.md) describe the maintained boundaries.
GUI measurements are opt-in and must run on a desktop available for automation.

## License

Project code is licensed under [MIT-0](LICENSE). Installed dependencies keep
their own licenses; they are not relicensed by this file.

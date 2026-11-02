# Verification scope

Run `npm run verify` for the automated checks. They use temporary storage,
isolated worker processes and controlled UI providers. They do not inject input
into working applications, use real accounts or send paid API requests.

## Automated coverage

- JavaScript syntax, domain ownership, public imports and dependency cycles.
- Window coordination: overlapping reads in different windows, ordered operations
  in one window, exclusive focus operations, and failed-bridge queue retirement.
  Read-only page polling tolerates unrelated input between observations. Activated
  keyboard batches retain the input tick and reject coordinates before activation.
- Durable jobs: long waits across worker processes, ownership release, timeout,
  STOP/cancellation, uncertain-action reconciliation, unreadable checkpoints,
  cleanup failures and reopened SQLite receipts.
- Challenges: checkbox and text submission, image selection, automatic completion,
  verified reload, a fresh second answer, replay prevention, ticket expiry, window
  binding, changed content and rejection of partial/read-only observations.
- Decisions budget: an uncertain paid request keeps its reservation after restart.
- Metrika: exact origin and counter identity, form interpretation and read-only
  dispatch boundaries.
- Distribution: tracked-file exclusions, English documentation, valid local links
  and consistent package/lockfile/license metadata.

Windows CI additionally builds the C# bridge, parses PowerShell scripts, runs the
native read-only self-test, audits production dependencies and scans Git history
with a pinned Gitleaks build. Read the CI result for the exact release commit;
checks on another revision do not certify a release.

## Limits

Windows 10 x64 has been exercised locally. Hosted Windows compilation and the
native capability self-test do not certify GUI behavior on every Windows version,
display scale, UI language, application build or account.

Challenge tests exercise the production plan executor against a controlled UI
provider. They do not demonstrate success with live CAPTCHA providers. Connector
entries marked `observed_plan` are execution contracts, not prebuilt or tested
recipes for every application feature. A worker returns `needs_decision` when a
new visual decision is needed; it does not replace the observing agent.

Concurrent stale-lock recovery and PID reuse are not covered by a general
multi-supervisor guarantee. Use one supervisor per job root. There is no atomic
transaction spanning a local receipt and a remote service's UI effect.

Live desktop measurements are opt-in and separate from automated verification.
Use sanitized fixtures for additional regressions; keep account data, screenshots,
logs and runtime journals out of source distribution. See
[release preparation](RELEASING.md) for the release procedure.

The opt-in [multi-window benchmark](MULTITASKING.md) exercises actual MCP capture
latency. Automated coordinator tests use controlled sessions; they do not replace
real checks of window size limits, shadows, occlusion or foreground behavior.

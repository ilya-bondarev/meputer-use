# Runtime architecture

See [verification scope](VERIFICATION.md) for automated coverage and limits.

## Dependency direction

```text
MCP / CLI -> runtime -> desktop / native / page adapters
                    -> persistence -> files / SQLite
                    -> services/<owner>/index.mjs
services -> other services' public entries, errors, contract validation
```

Domain functions accept ordinary values. No domain imports runtime, storage,
process spawning, desktop state, or transport routing. Domain owners are the
interface contract, durable jobs, Telegram, X, and Metrika. Each owner has a
RULES.md. The existing architecture gate enforces this dependency direction.

`connector-registry.mjs` is static composition, not a domain: it registers each
platform once. `job-validation.mjs` binds the registered platform names to the
pure graph validator. This small adapter preserves the existing one-argument
validation API without making the jobs domain depend on runtime composition.

## Responsibilities

| Module | One concern |
| --- | --- |
| `services/interface/selectors.mjs` | Interpret an observed UI tree |
| `services/interface/plans.mjs` | Validate a UI plan |
| `services/interface/pages.mjs` | Validate a page-read request |
| `services/interface/challenges.mjs` | Compose verified simple-challenge plans |
| `services/jobs/definition.mjs` | Validate a durable task graph |
| `services/jobs/bindings.mjs` | Interpret connector conditions and output bindings |
| `services/jobs/lifecycle.mjs` | Decide whether execution may continue |
| `services/jobs/identity.mjs` | Preserve v1 checkpoint identity |
| `services/jobs/outputs.mjs` | Bound saved outputs |
| `persistence/jobs.mjs` | Store and lock job checkpoints |
| `persistence/connector-journal.mjs` | Store connector delivery receipts |
| `runtime/job-runner.mjs` | Execute a graph against runtime ports |
| `runtime/desktop-coordinator.mjs` | Schedule per-window sessions and exclusive focus operations |
| `runtime/simple-challenge.mjs` | Coordinate bounded challenge attempts |
| `runtime/supervisor.mjs` | Dispatch due jobs into a cooperative worker slot |
| `adapters/process-liveness.mjs` | Probe process existence conservatively |
| `executor.mjs` | Execute a UI plan against a native backend |
| `connectors.mjs` | Compose platform rules with UI execution |

The runner's existing session, browser and connector factories remain its
injection points. No dependency-injection container, event bus, plugin loader or
new database is introduced. The public root modules remain compatibility entries;
there is one implementation behind each export.

## Compatibility boundaries

Saved graphs remain version 1. Job directories, file names, output envelopes,
request IDs, SQLite schema and existing root imports remain compatible by design.
Recovery tests exercise the existing root imports and v1 checkpoints. Legacy
browser nodes remain readable; new submissions continue to reject them.

Job digests deliberately preserve JSON property order. Connector fingerprints
deliberately canonicalize it. Changing either algorithm would invalidate saved
identity, so these superficially similar functions retain separate owners.

The Windows host retains observation expiry, the named input mutex, credential
handling and the UAC boundary. JavaScript cannot replace those native checks.
Window layout and read-only visible capture are native operations. The MCP
coordinator owns concurrency; it does not duplicate native input validation.
See [multiple windows](MULTITASKING.md) for the scheduling and capture contracts.

The public `JobStore` adds `definition`, `cancellationPath`, `cancelRequested`,
`receiptJournal`, `scan`, `lockSupervisor`, and `heartbeat`. Runtime code no longer
opens checkpoint files or constructs private receipt paths. Custom store
implementations used with `JobRunner` must implement the methods documented in
[the job contract](JOBS.md). Existing on-disk stores need no schema migration.

`list` fails visibly if a checkpoint cannot be read. `scan` returns healthy jobs
and per-job issues so an unreadable checkpoint cannot hide runnable work.

## Decisions and future cost

Keep Node.js orchestration and the C# host. A Rust rewrite would add a toolchain
and a second behavior migration before there is evidence of a backend bottleneck.
Keep atomic JSON checkpoints and SQLite receipts: they serve different durability
contracts, and migrating existing jobs is unnecessary for this separation.

Do not turn connector catalogs into claims of complete application coverage.
An `observed_plan` is an execution contract. A maintained recipe also needs
prerequisites, bounded inputs, a completion condition and a recovery policy.

Do not introduce snapshot deltas until identity and coverage have a clear native
contract: a delta must not make an expired reference actionable or turn a partial
tree into proof of absence. Do not remove delivery checks to improve a timing
number. Optimize observation volume and unnecessary process lifetime first.

## Review and verification boundary

Recovery checks exercise saved waits, process restart, uncertain effects and
cleanup failure. Challenge checks use the production executor with a controlled
UI provider. They verify input delivery separately from the next screen.

The architecture gate now also rejects missing local imports, import cycles,
unapproved domain dependencies and persistence-to-execution dependencies. It is
a source-level maintenance guard, not a security sandbox or a JavaScript parser.
It remains connected to the existing verify command, CI and optional hook;
these gates are included in the current verification run.

## Naming compatibility

The project, package, MCP identity and distributable skill are named `meputer-use`.
The exported `WindowsExecutor` class, the `WindowsExecutorSupervisor` scheduled
task identifier and native mutex keep their existing names for compatibility.
The old devtools cache directory is retained to reuse verified downloads. These
internal names do not define the product name. Renaming the checkout directory,
installed skill or a running MCP registration is not required for upgrade.

## Challenge continuation

The interface owner composes checkbox, text and image-selection plans. The
runtime executes them and returns a continuation only after observing the next
UI. A failed first attempt may reload the widget when an explicit rejection and
a changed-content condition are supplied. The agent then observes a new answer.

Second attempts reuse the existing SQLite receipt adapter in a separate
`local/challenge-requests/` journal. A five-minute ticket binds the retry to the
window and expected next UI. The receipt is committed before input; a restart
or repeated call cannot deliver that retry again. No second persistence schema,
provider SDK or OCR service is introduced.

## Related projects

- [agent-desktop](https://github.com/vercel-labs/agent-desktop)
- [ToolsEnabled Fleet](https://github.com/ToolsEnabled/fleet)

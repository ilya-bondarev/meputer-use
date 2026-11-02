# Durable execution contract

Status: alpha. Isolated recovery checks include real worker process exit and
restart. See [verification scope](VERIFICATION.md); these examples are not
evidence of real-account or arbitrary multi-supervisor verification.

## Execution modes

| Operation | Dispatch owner | Behavior |
| --- | --- | --- |
| `submit` / `resume` | Standalone worker | Start immediately; retain the process through waits |
| `enqueue` / `resume-queued` | Existing supervisor | Persist only; dispatch when a supervisor slot is available |
| `status` | Reader | Read one checkpoint |
| `list` | Reader | Return summaries or fail if any checkpoint is unreadable |
| `scan` | Reader | Return `{jobs, issues}` without hiding unreadable jobs |
| `cancel` | Active job's worker | Persist a cancellation request; observe cancellation at an execution boundary |

MCP uses these operation names on `desktop_job`. CLI equivalents:

```powershell
node src/job-cli.mjs enqueue job.json
node src/job-cli.mjs status JOB_ID
node src/job-cli.mjs scan
node src/job-cli.mjs resume-queued JOB_ID
```

Queueing succeeds even when no supervisor is running; the job remains queued.
It does not create a scheduled task or start a service. Start the supervisor
explicitly with `node src/supervisor.mjs` or use the optional installation step
in [installation](INSTALLATION.md). A queue receipt confirms persistence, not
execution or successful completion.

## Scheduling and waits

The supervisor dispatches at most one of its own workers at a time and defers
new dispatch while it sees an existing active worker. Direct standalone launches
remain possible for compatibility and are outside this scheduling guarantee.
The native mutex remains the cross-process input boundary.

Workers use a 30-second cooperative slice, checked between nodes. A node is not
interrupted mid-delivery to enforce fairness. Each dispatch saves progress and
eligible jobs are ordered by oldest checkpoint update, then ID. This prevents
a quickly checkpointing graph from always winning the next slot.

A waiting checkpoint with at least 30 seconds remaining releases its supervised
worker. Short waits retain the warmed native session until the slice ends.
The supervisor reads `wakeAt` and skips future waits. Cancelling a waiting job
makes it eligible immediately so a worker can record cancellation. STOP blocks
ordinary dispatch but allows this cancellation acknowledgement.

Wait polling is capped at its absolute timeout, so a large `pollMs` does not
defer timeout handling for an entire extra interval. There is still no hard
real-time guarantee: Windows scheduling, a running node and a condition read can
delay the next check. Conditions retain their existing success-before-timeout
evaluation order. `sleep` uses a saved wall-clock timestamp, not a process timer
that restarts from zero after recovery.

Worker slices and warm-session retention are separate policies even though
their current values match. Their owning constants live in `services/jobs/`.

## Persistence and recovery

The persisted format remains v1: `job.json`, `state.json`, `CANCEL`, and the job
lock live in each job directory. Connector receipts remain in the existing
SQLite journal. Checkpoints are validated when read and written. Invalid state
is reported and excluded from autonomous dispatch, not overwritten or deleted.
The supervisor records issue identifiers and codes in its heartbeat; `scan`
exposes them without printing the malformed checkpoint contents.

The worker writes `inFlight` before a consequential action. Resume preserves it.
Recovery checks the postcondition or connector receipt before considering a
repeat. An unverified non-idempotent action requires a decision. A completed
connector receipt remains a delivery receipt; its output contains the actual
verification status.

An adapter cleanup failure cannot skip releasing the job lock. When replacing
a failed desktop session, the worker also closes the connector that held that
session; the next call constructs a connector for the new session.

A returning runner clears its worker PID before releasing the job lock, including
when embedded in a process that stays alive. A checkpoint waiting for a supervisor
must not retain the caller's process as its execution owner.

Process IDs are hints, not ownership identities. Permission errors are treated
as possibly alive. The existing lock-file protocol is retained; simultaneous
recovery of a stale lock and PID reuse still need focused validation and a
stronger ownership design before claiming arbitrary multi-supervisor safety.
Run one supervisor per job root and do not manually remove a live worker's lock.
No exactly-once guarantee is made for external UI effects.

## Store port used by JobRunner

| Method | Contract |
| --- | --- |
| `lock(id)` | Return an asynchronous release function or fail without entering execution |
| `definition(id)` | Return a validated v1 graph |
| `read(id)` | Return a validated checkpoint |
| `save(state)` | Atomically persist the checkpoint and update its timestamp |
| `cancelRequested(id)` | Report whether cancellation has been requested |
| `cancellationPath(id)` | Provide the existing file cancellation boundary to the page adapter |
| `receiptJournal()` | Open an independent connector receipt handle scoped to this job store |

`JobStore.path` remains for older integrations, but the runner does not construct
private storage paths. A custom store port must provide equivalent durability;
an in-memory map cannot establish crash safety. No transaction covers both a
checkpoint write and a UI effect, so reconciliation remains mandatory.

The supervisor additionally uses `scan`, `lockSupervisor`, `heartbeat`, and the
public `root` used to start a detached worker. These process and filesystem ports
remain concrete rather than introducing a distributed scheduling abstraction.

## Verification

`tests/jobs.test.mjs` covers long waits across real worker processes, a returning
embedded runner, STOP and cancellation, polling longer than its timeout,
reconciliation without duplicate delivery, unreadable checkpoints beside healthy
jobs, cleanup throwing before lock release, and reopened SQLite receipts.
All test storage is temporary.
Concurrent stale-lock recovery and full desktop task interference still require
dedicated work before a broader concurrency guarantee can be made.

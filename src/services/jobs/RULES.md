# Durable job rules

This owner defines the v1 graph, conditions, output bindings and size limit,
checkpoint identity, and lifecycle decisions. It receives registered platform
names as a plain array. Registration belongs to the composition layer; importing
the domain must not start a worker, open a database, or access Windows.

Each durable UI node contains one action with an observable postcondition.
An in-flight record survives resume. An uncertain mutation cannot be repeated
unless its declared replay policy permits it; a worker restart is not evidence
that delivery failed. Connector request IDs retain their v1 digest format.

Graph hashes use the original JSON serialization, including property order.
Receipt fingerprints use a different, canonical serialization in persistence.
They are different contracts and must not be consolidated by apparent similarity.

Completed and cancelled jobs cannot resume. Failed and needs_decision jobs stop
automatic execution but may be explicitly resumed. Paused jobs also require
explicit resume; the legacy runner accepts paused state when invoked directly.

The existing graph format, output limit and validation order remain v1 contracts.
Persisting state and interpreting UI observations belong to their respective
adapters. Runtime orchestration composes them through public functions.

The lifecycle module owns scheduling eligibility, ordering, cooperative slice,
warm-wait retention and timeout-capped polling. Cancellation can wake a future
wait; uncertainty must be reconciled before yielding it as an ordinary wait.
Standalone execution retains responsibility for its own timers. Queueing alone
does not establish that a supervisor exists or that execution has begun.

Checkpoint validation rejects unknown status and malformed identity, outputs,
transition count or in-flight ownership. Storage reports invalid checkpoints;
the domain does not repair or delete them automatically.

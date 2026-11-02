# Verification scope

`npm run verify` checks JavaScript syntax, domain boundaries, preservation of an
uncertain Decisions budget reservation, and the Metrika origin/counter boundary.
It also checks skill overwrite protection and public source distribution rules.
It does not send paid requests or control the desktop. CI additionally compiles
the C# bridge on a Windows runner and scans Git history with a pinned Gitleaks
build. Public source checks require a Git checkout; archive users can build and
run the executor without those Git-specific checks.

Previous real-desktop checks used Windows 10 x64, ordinary Firefox, and Telegram
Desktop. They exercised browser text reading, native input, local credential
forms, observed plans, bookmark collection, and worker recovery. Local credential
form trials were successful, but are not guarantees about future agents or
third-party authentication services. No public service login fixture is shipped.

Metrika `counter.info` was exercised on an actual common-settings page through
the shared connector. Fresh MCP discovery included the service, and read/wait
contracts were validated. Some reads stopped with `USER_INTERFERENCE`; those were
not counted as successful reads. No counters, goals, permissions, or payments were
created by that connector verification.

Catalog entries marked `observed_plan` were not each exercised end to end on
real accounts. They describe a verified-plan execution contract. A raw action
receipt is not a verified business outcome. `needs_decision` requires an agent;
the worker cannot solve every unfamiliar screen independently.

Private screenshots, logs, account identifiers, and historical raw reports are
excluded from the public source. New clean-clone verification and secret scanning
are described in [release preparation](RELEASING.md).

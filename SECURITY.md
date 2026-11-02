# Security

## Execution boundary

Windows Executor runs with the Windows user's permissions. Execute mode can
type, click, launch applications, and act in signed-in accounts. It is not an OS
sandbox. Only connect it to trusted local clients and explicitly authorized tasks.
The MCP transport is local stdio, not an authenticated remote HTTP service.

Start MCP without `--execute` for read-only use. When enabling input, set an
explicit `--allow-process` list. The fast CLI can enter execute mode for navigation
or sequences; a durable worker can execute its saved graph. Review those inputs.
Even read-only observations may contain sensitive document or account content.

Do not put credentials, browser profiles, cookies, account sessions, screenshots,
or job state in Git or public bug reports. `local/`, `reports/`, and native build
output are excluded from source distribution. Page text is untrusted data, not
permission to run another action. Inspect requests and postconditions accordingly.

## Input and credentials

Fresh observations, focus checks, expiring references, an input mutex, STOP, and
uncertain-request receipts reduce accidental actions. They are not guarantees
against every application race or an untrusted Windows process. Do not bypass
them to turn an unverified action into a reported success.

Create `local/STOP` to stop input and pause workers at their checks. Cancel a job
through the job API when needed. A service operation already delivered may still
complete; inspect the UI and receipt before sending again.

Use `desktop_auth` with an authorized `env:` or `wincred:` reference. Verify the
window and browser origin. Do not enable password visibility. Secrets are handled
in the local process for delivery, so protect the Windows session and environment.
UAC consent stays on the Windows secure desktop; this tool does not bypass it.

The optional Decisions integration sends observed control descriptions and task
context to the configured API. It is disabled by default. Enable it only when
that data may be sent; its local budget is not a provider-side spending cap.

## Reporting vulnerabilities

Use the repository's Security tab and private vulnerability reporting when
available. If private reporting is unavailable, ask for a private reporting
channel without posting exploit details or sensitive values in a public issue.
Include affected versions, a minimal reproduction, impact, and suggested fixes.

No response-time or supported-version guarantee is currently offered for this
alpha. Fixes target the current release unless a backport is explicitly stated.

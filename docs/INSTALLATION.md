# Installation

Run commands from the root of your own clone. No account, installation directory,
window handle, counter ID, or credential is supplied by the repository.

```powershell
npm ci
npm run build
npm run verify
node src/cli.mjs selftest
node src/fast-cli.mjs windows
```

The build locates the Windows .NET Framework compiler through `WINDIR` and writes
a versioned executable to `bin/`. Node talks to it over stdin/stdout; there is no
local HTTP server. Keep the clone in a directory writable by your Windows user.

## MCP

Start read-only first:

```powershell
node src/mcp.mjs
```

This is a stdio MCP process, so an MCP client must manage its stdin/stdout.
Configure your client with the absolute paths of `node.exe` and `src/mcp.mjs`
inside your clone. For example, resolve them in PowerShell:

```powershell
$nodePath = (Get-Command node.exe).Source
$serverPath = (Resolve-Path .\src\mcp.mjs).Path
```

Use `$nodePath` as the command and `$serverPath` as the first argument in the
client's MCP configuration. To allow input, append these arguments explicitly:

```text
--execute
--allow-process=firefox,telegram
```

The example allowlist only permits Firefox and Telegram. Select the processes
needed for your task. Reconnect the MCP client after updating source code;
already running servers keep their loaded modules.

## Optional agent skill

```powershell
node scripts/install-skill.mjs
```

The destination uses `CODEX_HOME`, or `.codex` under your home directory.
The installed skill is named `meputer-use`; other installed skills are preserved.
Installing the skill is optional; MCP and CLI do not depend on it.
The installer preserves an existing skill. To replace it deliberately, run the
same command with `--force`. The active installation's skill is not changed by
cloning or building this project.

## Optional verification hook

```powershell
node scripts/install-hooks.mjs
```

This sets this repository's `core.hooksPath` to `.githooks`. It does not modify
global Git configuration. It replaces any repository-local hooksPath setting,
so keep an existing custom value if you need to restore it later.

## Optional task supervisor

```powershell
powershell -NoProfile -File scripts/install-supervisor.ps1
```

This installs a per-user Task Scheduler entry and starts the supervisor. It uses
the name `WindowsExecutorSupervisor`; the installer rejects a task with that
name belonging to a different clone. The supervisor can resume saved nonterminal
jobs under this clone's `local/jobs/`. Install it only
when you want jobs to survive chat exit and restart after sign-in. An active
interactive Windows session is still required for UI operations.

For cooperative scheduling use `desktop_job` operation `enqueue` or
`node src/job-cli.mjs enqueue job.json`. Queueing alone does not start the
supervisor. `submit` keeps the earlier standalone-worker behavior. The new
scheduler's verification scope is documented in [durable jobs](JOBS.md).

Remove the scheduled task with:

```powershell
powershell -NoProfile -File scripts/install-supervisor.ps1 -Remove
```

Removing it preserves job state. To stop input, create `local/STOP`. Remove the
file when ready and explicitly resume paused jobs. The setup commands above do
not install the supervisor automatically.

## Firefox accessibility

If Firefox exposes no useful UIA content, inspect `accessibility.force_disabled`
in `about:config`. A value of `1` disables accessibility; `0` permits it. Change
this preference yourself when appropriate. The installer does not modify browser
profiles, sessions, appearance, or accessibility preferences.

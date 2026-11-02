# Multiple windows

Use one MCP server for several tasks. Each exact HWND/PID pair owns a native
bridge and an operation queue. Reads in different windows can overlap; operations
in the same window stay ordered. The pool keeps up to eight window sessions and
reclaims idle entries when needed. A separate bridge handles window discovery.

Focus-changing calls and input share one queue. The native named mutex also
protects input from other executor processes. Separate windows do not create
separate keyboards, pointers, clipboards, or user sessions. Connector calls
currently share the input queue, including read-only connector calls.

## Arrange and observe

1. Get current HWND/PID pairs with `desktop_windows`.
2. Read `desktop_geometry` for bounds, monitor work areas and minimized state.
3. Call `desktop_layout` with `rect: {x, y, width, height}` in physical pixels.
   The requested rectangle must fit one monitor's work area. Applications can
   impose a larger minimum size; inspect the returned actual bounds. Layout
   restores minimized/maximized windows without requesting foreground focus.
4. Leave gaps for window shadows. Bring each task window forward once if other
   windows cover it, then keep the task windows arranged without overlap.
5. Send independent `desktop_text`, UIA, or `desktop_observe` with
   `kind: "visible"` calls concurrently. The client must dispatch concurrent MCP
   requests; a client that waits after every call remains sequential.

`visible` captures the window's DWM visual rectangle without activating it.
The response includes its physical origin and dimensions, but no actionable
`frameId`. It rejects minimized, off-screen, cloaked, or detectably covered windows
and reports the HWND/PID and rectangles of an occluder. Transparent overlays and
shadows may also block a capture. Visibility checks before/after a screen copy
are not atomic with Windows composition: a transient overlay can still race
the copy. Treat it as a read-only observation, never as authorization to click.

Before a coordinate action, activate the target and obtain a fresh foreground
frame. Its coordinates can differ from a DWM-cropped `visible` capture.
Do not reuse screen coordinates after resizing. A focus change or input from
another task can invalidate a frame; observe again instead of replaying a
possibly delivered action. User input checks and STOP remain active.

For a known keyboard sequence, use `desktop_sequence` with `activate: true`.
Activation, input and its delivery receipt share one focus turn and native
lease. This option accepts only `key`, `type` and `paste`, and rejects coordinate
actions before activation. Start with a shortcut that establishes the intended
field, such as Ctrl+L for a browser address. Verify the resulting UI afterwards.
For clicks in competing tasks, an observed connector plan can activate, observe
and act under one lease. Separate `desktop_activate` and `desktop_input` calls
are not one transaction; keep a single input owner when using those primitives.

## Scheduling limits

Read-only page polling releases the input queue. Navigation, Firefox console
extraction and input plans retain it for their operation, including readiness
waits. For independent background waits, navigate first and then request a
read-only page observation. Browser accessibility must actually be available;
a background screenshot is the fallback when the browser exposes no text.

This does not change durable-job scheduling: one supervisor still uses one
cooperative worker slot and persists long waits. It also does not provide a
global transaction spanning several separate MCP calls. A failed native bridge
is retired; queued operations on that bridge fail without replay. A later
request can establish a fresh bridge after the caller reconciles the UI.

## Measure your desktop

Arrange two to eight visible windows first. Substitute observed numeric IDs:

```powershell
node scripts/measure-windows.mjs --live --window=HWND:PID --window=HWND:PID --rounds=5
```

The script uses the real MCP transport in read-only mode. It compares sequential
and concurrent `visible` captures, alternates their order, and reports cold-start
time separately. It fails if a capture fails; errors are not counted as fast
observations. The default report is `reports/window-observations.json`, ignored
by Git. No screenshots, window titles, or UI text are saved by the benchmark.
The timing excludes model reasoning, navigation and application loading.

The design follows the same OS constraint described in agent-desktop's
[interaction lease](https://github.com/vercel-labs/agent-desktop/blob/main/CONCEPTS.md#interaction-lease):
several tasks can progress, while physical input remains exclusive.

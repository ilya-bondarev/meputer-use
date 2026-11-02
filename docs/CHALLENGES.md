# Challenge handling

`desktop_challenge` executes an agent-supplied answer through the ordinary UIA
executor. It supports a checkbox, a text field (including an answer read from an
image), or image tiles exposed as actionable UIA controls. The agent interprets
the screen; this module does not run OCR or call a CAPTCHA-solving service.

## Request

MCP takes `{window, challenge}`. CLI accepts the same JSON file:

```powershell
node src/fast-cli.mjs challenge request.json
```

Execution must be enabled and the observed window must be foreground. The CLI
also accepts `allowedProcesses` at the top level. Each challenge requires:

- `kind`: `checkbox`, `text`, or `image`.
- `present`: the condition for an unresolved challenge.
- `passed`: the intended next UI after verification.
- Optional `observe` and `timeoutMs`, with ordinary plan semantics.

Use these fields for the answer:

| Kind | Required answer fields |
| --- | --- |
| Checkbox | `target`, `checkboxOperation` (`invoke`, `toggle`, or `select`) |
| Text or image with a text answer | `target`, `answer`, `submit` |
| Image tiles | `selections`, `submit` |

Each image selection supplies `target`, `operation` (`invoke`, `toggle`, or
`select`) and `expect`, a condition proving that tile was selected. Up to 16
selections are accepted. The submit step verifies all selections before invoking
the observed submit control. Dynamic puzzles without reliable UIA controls need
separate observed native input or user help; this helper does not invent targets.

Example image selection (replace every selector with current observations):

```json
{
  "window": { "processName": "firefox", "title": "Observed window title" },
  "challenge": {
    "kind": "image",
    "selections": [{
      "target": { "name": "Tile 3", "role": "CheckBox" },
      "operation": "toggle",
      "expect": { "selector": { "name": "Tile 3", "role": "CheckBox" }, "toggleState": "On" }
    }],
    "submit": { "name": "Verify", "role": "Button" },
    "present": { "selector": { "name": "Verification required" }, "exists": true },
    "passed": { "selector": { "name": "Search results" }, "exists": true }
  }
}
```

`present` must describe unresolved verification, not a persistent widget container.
`passed` must identify the next usable screen, not a checked box or filled field.
The observation scope must include both. A truncated tree cannot prove absence.
Login OTPs and recovery codes belong to the credential workflow.

## Second attempt

There are at most two answer deliveries in one continuation workflow. The runtime
cannot know the answer to an unseen refreshed puzzle, so the agent supplies the
second answer in a separate call.

1. Optionally include `reload` in the first request: `{target, rejected, refreshed}`.
   `target` is the widget's reload button; `rejected` proves the answer was rejected;
   `refreshed` proves different challenge content loaded. A widget's continued
   presence alone is not evidence of reload. Do not use a page refresh that can
   repeat the original business action.
2. After a delivered answer times out, the tool checks those conditions. It invokes
   reload only if rejection is observed and the new-content condition is not yet
   true. Reload must clear rejection and establish the new content.
3. A verified reload returns `taskStatus: needs_observation`, `retryAllowed: true`,
   `retryToken`, and `expiresAt` (Unix milliseconds). Read the new screen and supply
   a new answer or tile selection with `retryToken`; omit `reload`. Keep `passed`
   unchanged. The challenge kind may change if the new screen requires it.
4. The ticket expires after five minutes and is bound to the observed window and
   intended next UI. The runtime verifies the refreshed state again. A SQLite
   receipt consumes the second attempt before input. Repeated or interrupted
   calls cannot deliver it again, including after a process restart.

Without `reload`, only the first attempt is made. Unknown rejection, failed reload,
interruption, expired tickets and a failed second attempt stop for a new decision
or user help. Do not restart the flow to evade its attempt limit.

The existing receipt adapter stores retry state under `local/challenge-requests/`.
Answer strings and screenshots are not stored there. Window titles and condition
labels may contain private context; keep this directory out of shared artifacts.
MCP and CLI must use the same clone to share these receipts.

## Result and continuation

Results include `taskStatus`, `continueTask`, `retryAllowed`, `attempt` and the
original plan `result`; a reload also includes `reloadResult`. Only freshly verified
completion sets `continueTask: true`. The agent then continues the original task.
An already-completed challenge skips input; automatic submission skips the submit
button. A cached second-attempt receipt returns `CHALLENGE_RETRY_ALREADY_USED`
without claiming that an old success describes the current screen.

The interface domain owns schemas, conditions, plans and retry rules. The runtime
owns orchestration; persistence uses the existing SQLite receipt contract.
Tests use the real executor with a controlled UI provider. Live provider behavior,
canvas-only puzzles and arbitrary application/account combinations are not covered.

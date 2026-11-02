# Performance and optional Decisions

Prefer text, then bounded accessibility, then pixels when visual interpretation
is required. Do not request a full tree or PNG after every keystroke.

- `desktop_text` reads browser TextPattern without changing focus.
- `desktop_page` combines navigation, readiness, and extraction. `dom`/`html`
  formats use ordinary Firefox Web Console input and the clipboard.
- `desktop_sequence` batches up to 128 stable native actions. `paste` replaces
  the clipboard; credentials must use `desktop_auth` instead.
- Save repetition as a routine and submit one durable graph rather than a new
  model/tool round trip for each item.

`routines/read-pages.mjs` builds page graphs. Supply fresh HWND/PID values and your
own absolute output directory in its arguments. `job-cli.mjs pages FILE` submits
the graph; `job-cli.mjs wait ID` waits up to 45 seconds for a compact status.

The X domain owns readiness for a requested post: its timestamp link must appear
inside the corresponding article. A URL change alone can still expose old text
during SPA rendering. Same-origin SPA navigation needs a text or selector
readiness condition. Extraction only covers loaded content; it does not unfold
an entire thread or visually read the image URLs/alt text it returns.

## Optional Decisions client

The implementation targets OpenAI `/v1/decisions` with `gpt-6-luna`. This
experimental integration is disabled unless `local/decisions.json` exists.
Core UI use and verification do not require an OpenAI key or paid request.
Confirm current API availability and pricing before enabling the integration.

The local JSON configuration contains an absolute `keyFile` path and `budgetUsd`
(greater than zero, at most 5). Store the key outside the repository. Keep this
configuration and its spend ledger private; neither belongs in Git.

The client chooses only among already observed ambiguous UIA controls. Unique
selectors and deterministic routines execute without a model call. Before input,
the executor observes again and checks the chosen identity. UI labels and goals
sent to the provider may themselves contain private data; enable this deliberately.

The shared ledger reserves funds before sending a request. Uncertain delivery
retains its reservation and is not automatically retried. The implementation's
cost estimate is a local safeguard, not a billing limit on the provider account.
Do not delete the ledger to reset the budget. See `decisions.mjs` for its current
reservation and pricing constants; `check-budget.mjs` verifies recovery without
using a real key or network.

## Measurements

Measure against your own workload, application versions and desktop. Record
observation time, model/tool round trips and verified completion separately;
warm-browser results do not establish a general speed guarantee.

The opt-in `scripts/measure-ui.mjs --live --unknown` uses your own
`reports/speed-before.json` containing `cases` with `url`, `marker`, and
`elapsedMs`. It changes the real browser tab. Run it only on an available desktop;
it is never part of automatic verification or installation.

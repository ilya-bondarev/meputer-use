# Yandex Metrika through the interface

This module owns the operation catalog, section addresses, and interpretation
of observed Metrika fields. Its public entry is `index.mjs`. Windows input,
storage, receipts, and waits belong to the common executor. No Metrika API,
OAuth token, browser profile inspection, or remote driver is used.

## Ready operations

- `open`: counters/preferences reject counterId; counter pages require a positive
  decimal counterId string. Arbitrary addresses and query parameters are rejected.
- `goals` opens goal results; `conversions` opens the chart for the same report.
  Goal editing uses the observed settings UI, not an invented tab address.
- `counter.info` reads settings/common. Its own form number must agree with the
  single URL id. A truncated tree is insufficient. Returned fields and Save
  availability do not prove that settings have been persisted.
- `ui.text`/`ui.read` validate the exact HTTPS Metrika origin. A Yandex sign-in
  page must not be mistaken for Metrika. Settings field parsing currently targets
  the Russian Metrika UI; its literal labels are intentionally retained in code.

## Observed plans

counter/goal/report/segment/filter/access/dashboard/behavior/integration/data are
observed-plan scenario names, not ready recipes. Use a fresh plan, requestId,
receipt, and observable result. Verify the account and counter before changing
them; capture the target in before/expect conditions. On a passport sign-in page,
use `desktop_auth` with its exact expectedOrigin and recheck the account afterward.

Reopen a section to verify persistence. Creating a goal does not prove that it
was reached; sending an event does not prove that a report recorded a conversion.
An empty or unloaded report does not establish zero traffic. Capture the period,
segment, attribution, and sampling when interpreting a report. Charts and session
replay need visual observation. Verify exports against the resulting file.

Installing site code is a separate authorized task. No operation automatically
enables session replay. Use existing connector nodes and read-only waits for
durable work; use a page node for replayable navigation. Reconcile uncertain
changes before considering another delivery.

# Shared interface contracts

This module owns the schemas for shared UI operations and the observed-plan
contract. Catalog names do not establish account availability or end-to-end
coverage. A plan needs observable postconditions; input delivery is not a
substitute. An unverified raw action cannot be used as a durable result.

This owner also defines selectors, three-valued condition evaluation, UIA v1
plans, and page request validation. These functions take ordinary values and
do not observe or change a desktop. A truncated tree cannot prove absence;
an ambiguous selector cannot prove a single element's value. Execution adapters
import these contracts, never the other way around.

Challenge handling belongs to this owner because it composes the same observed
selectors, conditions and v1 plans. Checkbox, text and image requests use answers
or tile selections supplied by the observing agent. No provider solver is hidden
inside the runtime. Success requires both a cleared challenge and the intended
next UI; completed or automatically submitted challenges skip unnecessary input.

A first attempt may reload only after a postcondition timeout and an observed
rejection. Reload must clear that rejection and establish changed challenge
content. A fresh observation supplies the second answer. One durable, expiring
retry ticket binds that second attempt to the window and next-UI condition.
It is consumed before input and cannot authorize a third delivery. An uncertain
business action is never replayed as part of challenge handling.

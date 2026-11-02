# Contributing

Use Node.js 24+ and Windows x64 with the .NET Framework 4.x compiler available.
Run `npm ci`, `npm run build`, and `npm run verify` from a clean clone.

Keep each platform's rules in its `src/services/<domain>/` owner with a RULES.md.
Use public index functions rather than another module's private tables or state.
Domain code takes and returns plain values and must not import native input,
HTTP, persistence, or routing. Register a service once in `connectors.mjs`.

Search existing code before adding a rule or schema. Keep behavior-preserving
refactors separate from behavior changes. Prefer existing functions and plain
data over additional dependencies, frameworks, schedulers, or speculative hooks.
The architecture gate is part of CI and the optional repository-local hook.

Add a targeted regression check when it protects a real failure or important
boundary. Do not add tests that merely repeat the implementation. Automatic
verification must not use real credentials, paid APIs, real-account mutations,
or a contributor's desktop. GUI checks are opt-in and need an available session.

Describe the problem, final behavior, validation, and remaining limitations in
your pull request. Distinguish real-account verification from local fixtures,
input delivery from verified outcomes, and catalog contracts from ready recipes.

Bug reports should include versions, a minimal sanitized request, the error code,
and expected/observed behavior. Omit tokens, credential values, job journals,
browser profiles, private URLs, and screenshots of confidential content.
Report vulnerabilities using [SECURITY.md](SECURITY.md).

Submit contributions under this repository's MIT-0 license. Third-party code
must retain its applicable license and notices; do not relicense dependencies
by changing this repository's LICENSE file.

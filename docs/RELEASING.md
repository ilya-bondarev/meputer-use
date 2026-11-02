# Release preparation

1. Review tracked files, examples, license metadata, and third-party notices.
   Exclude runtime data, credentials, profiles, screenshots, and machine-specific
   account identifiers. A clean source snapshot must not include private Git refs.
2. Verify a fresh clone: `npm ci`, `npm run build`, `npm run verify`, and
   `node src/cli.mjs selftest`. The self-test queries native capabilities without
   activating or controlling any window. Test another Windows environment in CI.
3. Run `npm run secrets` on the candidate Git history and staged source. This
   downloads a pinned, SHA-256-verified Gitleaks build into the local user cache;
   it is a development tool, not an application dependency. For an extracted
   source archive, pass its path to `scripts/scan-secrets.ps1 -Source PATH`.
   Output is redacted. If a real secret is found, keep the candidate private
   and rotate that secret as appropriate; removing a file is not revocation.
4. Ensure the Windows verification and secret checks pass on the exact commit
   to be released. Keep GitHub Actions permissions read-only for verification.
5. Review the staged/private repository before making it public. Enable secret
   scanning/push protection, dependency alerts, and private vulnerability reporting
   where GitHub makes them available. Set the default branch to main and require
   the verification checks before merging contributions.
6. Tag the version declared by package.json and publish a source archive with a
   SHA-256 checksum. Export tracked files only, using `git archive`; do not zip
   an entire working directory containing local state or node_modules.

Compilation on a hosted Windows runner does not certify real GUI behavior on
every Windows version, language, display scale, application build, or account.
Record what actually ran and distinguish it from manual checks still needed.

Legacy direct browser-driver imports remain for compatibility. New supported
submissions use the ordinary Windows UI path. Do not describe the catalog as
universal autonomous coverage or publish private historical logs as evidence.

---
'@nanocollective/nanocoder': patch
---

Fix `test:audit` to fail on unhandled high and critical security vulnerabilities by removing `--ignore-unfixable`, and configure `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml` for the accepted `@azure/msal-node` dev-only advisory. Closes #1929.

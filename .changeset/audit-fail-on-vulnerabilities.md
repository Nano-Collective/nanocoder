---
'@nanocollective/nanocoder': patch
---

- Remove `--ignore-unfixable` from `pnpm run test:audit` in `package.json` so security audits properly fail when unhandled high or critical vulnerabilities exist.
- Allow-list the dev-only `@azure/msal-node` advisory (`GHSA-xcx6-jx8p-x3h5`) under `auditConfig.ignoreGhsas` in `pnpm-workspace.yaml`.

Closes #1929.

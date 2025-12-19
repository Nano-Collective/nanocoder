# Winter Cleanup 2025 - Issue Index

This directory contains issue templates for the nanocoder winter cleanup initiative.

## Critical Priority

| # | Issue | File |
|---|-------|------|
| 01 | Fix silent configuration failure | [01-fix-silent-config-failure.md](01-fix-silent-config-failure.md) |
| 02 | Fix async error handling in file-snapshot | [02-fix-async-error-handling.md](02-fix-async-error-handling.md) |
| 03 | Add CI test workflow for PRs | [03-add-pr-test-workflow.md](03-add-pr-test-workflow.md) |

## Security

| # | Issue | File |
|---|-------|------|
| 04 | Replace insecure Math.random() | [04-security-fix-insecure-randomness.md](04-security-fix-insecure-randomness.md) |
| 05 | Fix command injection vulnerabilities | [05-security-fix-command-injection.md](05-security-fix-command-injection.md) |
| 06 | Fail fast on missing API key | [06-security-fail-fast-missing-api-key.md](06-security-fail-fast-missing-api-key.md) |

## CI/CD

| # | Issue | File |
|---|-------|------|
| 07 | Update deprecated GitHub Actions | [07-update-deprecated-github-action.md](07-update-deprecated-github-action.md) |
| 08 | Add Dependabot configuration | [08-add-dependabot.md](08-add-dependabot.md) |

## Code Quality

| # | Issue | File |
|---|-------|------|
| 09 | Consolidate message components | [09-consolidate-message-components.md](09-consolidate-message-components.md) |
| 10 | Replace console.* with logger | [10-replace-console-with-logger.md](10-replace-console-with-logger.md) |
| 11 | Remove deprecated functions | [11-remove-deprecated-code.md](11-remove-deprecated-code.md) |
| 12 | Extract magic numbers to constants | [12-extract-magic-numbers.md](12-extract-magic-numbers.md) |

## Performance

| # | Issue | File |
|---|-------|------|
| 13 | Convert sync file ops to async | [13-convert-sync-file-ops-to-async.md](13-convert-sync-file-ops-to-async.md) |
| 14 | Add cache size limits | [14-add-cache-size-limits.md](14-add-cache-size-limits.md) |
| 15 | Fix over-fetching in tools | [15-fix-over-fetching-in-tools.md](15-fix-over-fetching-in-tools.md) |

## Documentation & Config

| # | Issue | File |
|---|-------|------|
| 16 | Fix broken README link | [16-fix-readme-broken-link.md](16-fix-readme-broken-link.md) |
| 17 | Clean up env variable docs | [17-clean-up-env-variables.md](17-clean-up-env-variables.md) |

## Refactoring

| # | Issue | File |
|---|-------|------|
| 18 | Split large files | [18-split-large-files.md](18-split-large-files.md) |

---

## Suggested Order

1. **Week 1**: Critical fixes (#01, #02, #03)
2. **Week 2**: Security (#04, #05, #06, #07)
3. **Week 3**: Code quality (#09, #10, #11)
4. **Week 4**: Performance & polish (#13, #14, #15, #08, #12, #16, #17, #18)

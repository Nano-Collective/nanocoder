---
"@nanocollective/nanocoder": minor
---

Negative-space mutation firewall (#1577). Defines deterministic, zero-token validation boundaries for file mutations (`write_file`, `string_replace`, `diff_edit`). Rejects violating mutations before disk writes occur:
- Blocks explicit `any` type injections when strict typing was previously present.
- Blocks deletion of existing unit test cases in test files.
- Preserves top-level exported API signatures from unintended removal.
- Protects core project config and lockfiles (`package.json`, `pnpm-lock.yaml`, tsconfigs, `.github/workflows/**`, `biome.json`) from unconfigured agent overwrite.
- Adds `/firewall` slash command to inspect status, toggle rules, change mode (`strict` | `lenient` | `disabled`), and configure protected glob patterns.

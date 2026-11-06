---
"@nanocollective/nanocoder": minor
---

Negative-space mutation firewall (Part of #1577). Defines deterministic, zero-token lexical validation boundaries for file mutations (`write_file`, `string_replace`, `diff_edit`). Rejects violating mutations before disk writes occur:
- Opt-in by default (`enabled: false`, `mode: 'disabled'`) so headless runs, daemon workflows, and open editing remain undisturbed until activated.
- Configurable via `agents.config.json` under `nanocoder.firewall` (with project/user level discovery).
- Pure lexical syntax analysis engine with zero dynamic dependencies or runtime compiler loading.
- Blocks explicit `any` type injections when strict typing was previously present.
- Blocks deletion of existing unit test cases in test files.
- Preserves top-level exported API signatures from unintended removal.
- Supports user-configurable protected glob patterns via `/firewall protect <pattern>` / `/firewall unprotect <pattern>`.
- Adds `/firewall` slash command to inspect status, enable/disable, toggle rules, change mode (`strict` | `lenient` | `disabled`), and reset to configured defaults (`/firewall reset`).

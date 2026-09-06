---
"@nanocollective/nanocoder": patch
---

Fixed the subagent activity card in the ACP (VS Code extension) integration truncating token counts to whole thousands (`Math.floor(tokenCount / 1000)`), so 1–999 tokens showed as `0k` and 1500–1999 showed as `1k`. Now uses the existing `formatCompactTokenCount` formatter from `source/usage/format.ts`, matching the precision already used by the per-response usage indicator (e.g. `1.9k tokens` instead of `1k tokens`). Closes #1133.

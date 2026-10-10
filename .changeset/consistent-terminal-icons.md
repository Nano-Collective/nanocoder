---
"@nanocollective/nanocoder": minor
---

Gave the terminal UI one consistent set of monochrome icons, defined in `source/components/ui/icons.tsx`, in place of the mix of colour emoji (`🟢`, `🔴`, `📋`, `👋`, `💻`, `🌐`, `🔄`, `❓`) and one-off symbols. Tool headers now use `»` instead of `⚒`, `/mcp` and `/lsp` show transport and readiness with plain symbols, and the status panel, command lists, pickers, task list, file explorer and `/doctor` share the same bullets and markers. A few of the symbols (`○`, `◐`, `❯`) are East-Asian-Ambiguous, so they can still draw two columns wide in a CJK-configured terminal.

Tool-validation failures now start with `! Validation failed` instead of `⚒ Validation failed`. Sessions saved before this release still show their old failed tool calls as failures when resumed.

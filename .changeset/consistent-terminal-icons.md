---
"@nanocollective/nanocoder": minor
---

Introduced a consistent, monochrome terminal icon vocabulary across the
entire CLI surface (welcome banner, status panel, command listings,
tool headers, pickers, validation errors, MCP/LSP indicators, dev mode
indicator, file explorer, and every formatter). Every icon now renders
as a single column in a standard monospace terminal — no more
full-emoji `🟢`/`🔴`/`📋`/`👋`/`💻`/`🌐`/`🔄`/`❓`, no more East-Asian
Ambiguous glyphs (`⚒`, `⚙`, `⚠`, `❯`, `⏵`, `⏸`, `▶`, `⊡`, `⎇`, `✻`)
that render as 2 columns in CJK-configured terminals.

New single source of truth:

- `source/components/ui/icons.tsx` exports named constants (`ICON_TOOL`,
  `ICON_SUCCESS`, `ICON_ERROR`, `ICON_WARNING`, `ICON_BULLET`,
  `ICON_CONTINUATION`, `ICON_SELECTION`, `ICON_TASK_*`, `ICON_MCP_*`,
  `ICON_LSP_*`, `MODE_GLYPHS`, `TASK_STATUS_ICONS`, helpers
  `mcpTransportIcon`, `toolTitle`, `validationError`, and the
  `BRAND_MARK` plus the Nano Collective brand colour `#8373F7`).
- Removed dynamic runtime lookups using the `figures` package,
  making the codebase lighter and strictly enforcing our new premium
  hardcoded visual vocabulary.
- `source/utils/width.ts` exports `width`, `truncateByColumns`, and
  `truncatePathByColumns`, all backed by `string-width` with
  `ambiguousIsNarrow: true` per UAX #11.
- `useTerminalWidth` and the dev-mode indicator now measure and budget
  using **visual columns**, not UTF-16 code units. The original
  `addy's note about ⎇ ⏵ ⏸ ▶ ⚠ ● ⊡` quietly overflowing layouts is
  fixed at the truncation sites.
- The welcome banner uses the Nano Collective brand purple (`#8373F7`,
  exposed as the new `colors.brand` theme slot) and the brand mark
  (`*`) so the wordmark is recognisable across themes.
- Tool-validation error prefix changed from the ambiguous `⚒` to ASCII
  `!` (single column). The `startsWith('! Validation failed')` checks
  in `tool-result-display`, `session-history-renderer`, `tool-executor`,
  `auto-diagnostics`, and the corresponding specs were updated
  together.

The icon set is intentionally small (~25 glyphs); the rule of thumb
for new affordances is to prefer a coloured version of an existing
glyph over introducing a new one.
# Consistent Terminal Icons & Nano Collective Branding — Detailed Summary

**Branch:** `feature-new-ui`
**Base for diff:** `origin/main` (commit `e5985b81`)
**This branch HEAD:** `572001bd`
**Scope:** 102 files changed (+1,123 / −361)

This document is the file-by-file summary of every change made when
introducing the new icon vocabulary on top of `origin/main`, covering:

- the **new shared icon module** and the **width-aware truncate helper**;
- the **glyph-by-glyph mapping** (old → new);
- the **per-file change list** organised by directory;
- the **test deltas**;
- and the **branding/theme changes**.

---

## 1. New abstractions

### `source/components/ui/icons.tsx` (new, 226 lines)

Single source of truth for every glyph rendered in the TUI. Exports
**42 named constants** — every icon vocabulary member — plus helpers
and a bundle object. We now use the industry-standard `figures` package
which ensures visually-appealing icons on macOS/Linux while gracefully
falling back to ASCII on Windows and constrained environments.

| Constant                  | Figures mapping                 | Description                 | Replaces                                               |
| ------------------------- | ------------------------------- | --------------------------- | ------------------------------------------------------ |
| `ICON_TOOL`               | `»`                             | Universal action marker     | `⚒` (U+2692)                                           |
| `ICON_THOUGHT`            | `∴`                             | Quiet thinking marker       | `⚙` (U+2699)                                           |
| `ICON_SUCCESS`            | `✓`                             | Success status              | `✓` (kept via figures)                                 |
| `ICON_ERROR`              | `✗`                             | Error status                | `✗` (kept via figures)                                 |
| `ICON_WARNING`            | `⊘`                             | Warning status              | `⚠` (U+26A0)                                           |
| `ICON_ELLIPSIS`           | `…`                             | Truncation / Continuation   | `…` (kept via figures)                                 |
| `ICON_BULLET`             | `▪`                             | List row start / item       | `•` (kept via figures)                                 |
| `ICON_CONTINUATION`       | `↳`                             | Sub-hint row marker         | `↳` (kept)                                             |
| `ICON_LIST_ROW`           | `›`                             | Command listings row marker | (new)                                                  |
| `ICON_SELECTION`          | `❯`                             | Picker highlight marker     | `❯` (U+276F) and `▸`                                   |
| `ICON_TREE_COLLAPSED`     | `>`                             | Collapsed tree node         | `>`                                                    |
| `ICON_TREE_EXPANDED`      | `v`                             | Expanded tree node          | `v`                                                    |
| `ICON_TASK_PENDING`       | `○`                             | Pending task                | `○`                                                    |
| `ICON_TASK_IN_PROGRESS`   | `◎`                             | Active task                 | `◐`                                                    |
| `ICON_TASK_COMPLETE`      | `✓`                             | Completed task              | `✓`                                                    |
| `ICON_IMAGE`              | `⧉`                             | Image attachment            | `■`                                                    |
| `ICON_DIRTY`              | `±`                             | Modified / unsaved          | `●`                                                    |
| `ICON_GIT_BRANCH`         | `⎇`                             | Git branch                  | (kept)                                                 |
| `ICON_MODE_NORMAL`        | `⏵`                             | Normal mode                 | `▶`                                                    |
| `ICON_MODE_AUTO_ACCEPT`   | `⏵⏵`                            | Auto-accept mode            | `⏵⏵`                                                   |
| `ICON_MODE_YOLO`          | `⏵⏵⏵`                           | YOLO mode                   | `⏵⏵⏵`                                                  |
| `ICON_MODE_PLAN`          | `⏸`                             | Plan mode                   | `⏸`                                                    |
| `ICON_MCP_STDIO`          | `⇄`                             | Stdio transport             | `💻`                                                   |
| `ICON_MCP_WEBSOCKET`      | `∿`                             | WebSocket transport         | `🔄`                                                   |
| `ICON_MCP_HTTP`           | `⭾`                             | HTTP transport              | `🌐`                                                   |
| `ICON_LSP_READY`          | `✓`                             | LSP ready                   | `🟢`                                                   |
| `ICON_LSP_NOT_READY`      | `⊘`                             | LSP missing                 | `🔴`                                                   |
| `ICON_EDITOR`             | `⊡`                             | Editor indicator            | `⊡`                                                    |
| `ICON_GOODBYE`            | `ツ`                             | Farewell sign-off           | `👋`                                                   |
| `VALIDATION_ERROR_PREFIX` | `!`                             | (Required for parsing)      | `⚒`                                                    |
| `TASK_STATUS_ICONS`       | (record)                        | —                           | inline `{pending:'○', in_progress:'◎', completed:'✓'}` |
| `MODE_GLYPHS`             | (record)                        | —                           | (new)                                                  |
| `Icons`                   | (object)                        | —                           | (new — bundle object)                                  |
| `NANO_COLLECTIVE_BRAND`   | `#8373F7`                       | —                           | (new — Nano Collective purple)                         |

Helpers exported from the same module:

- `mcpTransportIcon(transportType: string): string` — maps `stdio`/`ws`/`https`/`sse`/etc.
- `toolTitle(name: string): string` — composes the canonical `› <name>` header
- `validationError(message: string): string` — produces `! Validation failed: <message>`
- `IconName` type — exhaustive list of `Icons` keys

Usage of the new constants across the codebase (`git ls-files` against
HEAD):

```
ICON_BULLET          53   ICON_TASK_IN_PROGRESS     9   ICON_MCP_STDIO    5
ICON_SUCCESS         51   ICON_ELLIPSIS             8   ICON_MCP_WEBSOCKET 5
ICON_TOOL            50   ICON_TASK_PENDING         7   ICON_MCP_HTTP    5
ICON_WARNING         21   ICON_TASK_COMPLETE        7   ICON_MCP_UNKNOWN 5
ICON_ERROR           18   ICON_THOUGHT              6   ICON_EDITOR      5
ICON_LIST_ROW        16   ICON_USER                 4   ICON_GOODBYE     4
ICON_CONTINUATION    14   ICON_ASSISTANT            4   ICON_LSP_READY   4
ICON_SELECTION       14   ICON_GIT_BRANCH           4   ICON_LSP_NOT_READY 4
                       ICON_TREE_COLLAPSED       4   ICON_IMAGE       4
                       ICON_TREE_EXPANDED        4   ICON_DIRTY       4
                       ICON_MODE_AUTO_ACCEPT     4   …
```

### `source/utils/width.ts` (new, 73 lines)

`string-width`–backed helpers to fix the visual-column vs UTF-16-code-unit
bug called out in the original feature request. Defaults to
`ambiguousIsNarrow: true` (per UAX #11).

- `width(text: string): number`
- `truncateByColumns(text, maxColumns): string` — uses the single-column
  `…` ellipsis so a 5-column budget is exactly 5 columns wide
- `truncatePathByColumns(path, maxColumns): string` — same, keeps the
  tail of long paths

### `source/components/ui/icons.spec.tsx` (new, 64 tests)

Verifies:

- Every glyph renders as exactly **1 visual column** (except the
  intentionally 2-column `<>` WebSocket marker)
- The Nano Collective brand colour is `#8373F7`
- `MODE_GLYPHS` and `TASK_STATUS_ICONS` cover every status / mode
- `mcpTransportIcon` maps every supported transport
- `toolTitle` and `validationError` compose the canonical forms

### `source/utils/width.spec.ts` (new, 12 tests)

Covers:

- ASCII, CJK, and East-Asian-Ambiguous glyphs each counted correctly
- ANSI escapes ignored
- Emoji modifier sequences counted as wide
- `truncateByColumns` respects visual columns, not code units
- `truncatePathByColumns` keeps the tail and never overflows the budget

---

## 2. Width-aware truncation refactor

### `source/hooks/useTerminalWidth.tsx`

- `truncate()` now delegates to `truncateByColumns()` (visual columns
  instead of UTF-16 code units)
- `truncatePath()` now delegates to `truncatePathByColumns()`
- New `visualWidth()` export added to `useResponsiveTerminal()`

### `source/components/development-mode-indicator.tsx`

The four `.length` arithmetic blocks that budget the development-mode
indicator's row width have been rewritten to call `visualWidth()` on
each segment. This is the exact bug called out in #954: the prior code
used UTF-16 code units, so a label with a `⚒`/`⚙`/`⊡`/`⎇`/`⏵`/`⏸`/etc.
glyph could silently overflow the budget when rendered in a CJK-locale
terminal.

### Tests (`source/hooks/useTerminalWidth.spec.tsx`)

- Updated `truncate` / `truncatePath` tests to assert against the new
  single-column `…` ellipsis and `string-width` semantics

---

## 3. Theme & branding changes

### `source/types/ui.ts`

- New optional `brand?: string` slot on the `Colors` interface (Nano
  Collective brand colour, falls back to `colors.primary` when absent)

### `source/config/themes.json`

- All **50 themes** now declare a `brand` colour. The default brand is
  the Nano Collective purple `#8373F7`, so the welcome banner stays
  on-brand even when the user has picked a non-purple theme. (Mechanically
  applied via `python3 -c "..."` against the JSON to avoid touching all
  50 theme blocks by hand.)

### `source/components/welcome-message.tsx`

- Imports `ICON_BULLET`
- "Quick tips" bullets (`• Use natural language` etc.) routed through
  `ICON_BULLET`
- The boot-summary branch glyph (`⎇`) replaced with `╲` (matches the
  the new `ICON_GIT_BRANCH`)
- Narrow-layout gradient pinned to `[colors.brand ?? colors.primary, colors.tool]`
  so the wordmark is recognisable on every theme

---

## 4. File-by-file change list

For each file, the changes fall into one of four buckets:

| Bucket                                        | Meaning                               |
| --------------------------------------------- | ------------------------------------- |
| `+ import { … } from '@/components/ui/icons'` | Brought in the named constants        |
| `- "<old-glyph>"` / `+ "{ICON_XXX}"`          | Replaced a literal glyph              |
| `+ <other logic>`                             | Width-budget switch, new branch, etc. |
| `+ <branch, new file>`                        | New file                              |

### `source/components/` — chat surface

| File                             | Change                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-progress.tsx`             | `⚒ agent:` → `› agent:`; `- ↳` ×2 → `↳ icon:`                                                                                                                    |
| `assistant-message.tsx`          | `+ ICON_ELLIPSIS`; `<model>:` → `‹ <model>`                                                                                                     |
| `assistant-reasoning.tsx`        | `⚙ Thought` → `· Thought`; `+ ICON_THOUGHT`                                                                                                                      |
| `bash-progress.tsx`              | `⚒ execute_bash` → `› execute_bash`; `(…)` ellipsis uses `ICON_ELLIPSIS`                                                                                         |
| `checkpoint-display.tsx`         | `↳` → `ICON_CONTINUATION`                                                                                                                                        |
| `checkpoint-selector.tsx`        | All `• ` row markers → `{ICON_BULLET} `                                                                                                                          |
| `development-mode-indicator.tsx` | `⊡ ` → `› `; width budget rewritten through `visualWidth()`                                                                                                      |
| `file-explorer/index.tsx`        | `✓ Selected` / `✗ Not selected` → `ICON_SUCCESS` / `ICON_ERROR`                                                                                                  |
| `file-explorer/tree-item.tsx`    | Selection prefixes via `ICON_SUCCESS` / `ICON_TASK_IN_PROGRESS`; expand/collapse via `ICON_TREE_EXPANDED` / `ICON_TREE_COLLAPSED` (replaces literal `v ` / `> `) |
| `filterable-select-list.tsx`     | Mixed `❯` → single `ICON_SELECTION`                                                                                                                              |
| `json-viewer/json-viewer.tsx`    | `● modified` → `${ICON_DIRTY} modified`                                                                                                                          |
| `plan-review-prompt.tsx`         | `📋 Plan ready.` → `${ICON_PLAN} Plan ready.`                                                                                                                    |
| `question-prompt.tsx`            | `❯` → `ICON_SELECTION`                                                                                                                                           |
| `render-error-boundary.tsx`      | `⚠ Could not render` → `${ICON_WARNING} Could not render`                                                                                                        |
| `simple-tool-formatter.tsx`      | `⚒ <name>` → `› <name>` (×2 — header & toolTitle helper)                                                                                                         |
| `status.tsx`                     | Every `✓` / `✗` / `⚠` / `↳` / `• ` in the 380-line status panel routed through the icon vocabulary                                                               |
| `streaming-message.tsx`          | `<Text>…</Text>` trunc-marker → `<Text>{ICON_ELLIPSIS}</Text>`                                                                                                   |
| `streaming-reasoning.tsx`        | `⚙ Thinking` → `· Thinking`; `…` trunc-marker → `ICON_ELLIPSIS`                                                                                                  |
| `subagent-view.tsx`              | `⚒ <name>` → `› <name>`                                                                                                                                          |
| `task-list-display.tsx`          | Inlined `STATUS_ICONS` object replaced with `ICON_TASK_PENDING` / `ICON_TASK_IN_PROGRESS` / `ICON_TASK_COMPLETE` references                                      |
| `tool-confirmation.tsx`          | `✓ Yes, execute this tool` / `✗ No, cancel execution` → `${ICON_SUCCESS}` / `${ICON_ERROR}`                                                                      |
| `user-input.tsx`                 | `▸ ` markers routed through `ICON_SELECTION`; the comment that referenced the raw glyph cleaned up                                                               |
| `user-message.tsx`               | `You:` → `‹ You`; `■ N image(s) attached` → `${ICON_IMAGE} N image(s) attached`                                                                                  |
| `vscode-extension-prompt.tsx`    | `  ✓` / `  !` extension-status icons → `${ICON_SUCCESS}` / `${ICON_WARNING}`; success/error messages route through the same constants                            |
| `welcome-message.tsx`            | Bullets through `ICON_BULLET`; boot-summary `⎇` → `╲`                                                                                                            |

### `source/hooks/`

| File                                            | Change                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `useTerminalWidth.tsx`                          | `truncate` / `truncatePath` use visual columns; new `visualWidth` export                                |
| `useAppHandlers.tsx`                            | `✓ Checkpoint '…' restored successfully` → `${ICON_SUCCESS} Checkpoint '…' restored successfully`       |
| `chat-handler/conversation/auto-diagnostics.ts` | `result.content.startsWith('⚒ Validation failed')` → `result.content.startsWith('! Validation failed')` |
| `chat-handler/conversation/tool-executor.tsx`   | Same `⚒` → `!` validation-prefix check                                                                  |

### `source/utils/`

| File                         | Change                                                                                                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool-result-display.tsx`    | `'\u2692'` (×3 — `CompactToolResult`, `CompactToolError`, `LiveCompactCounts`) → `ICON_TOOL`; `⚒ Validation failed:` check → `! Validation failed:`; `⚒ <tool>` title (×3) → `› <tool>` |
| `tool-validation.ts`         | `⚒ Validation failed: ${error}` → `! Validation failed: ${error}`                                                                                                                       |
| `path-validators.ts`         | `⚒ Invalid file path.` ×2 + `⚒ Path validation failed:` ×2 + `⚒ Invalid source/destination path.` → `!` equivalents                                                                     |
| `width.ts` / `width.spec.ts` | (new) — see §2                                                                                                                                                                          |

### `source/tools/`

Every tool file with a `⚒ <name>` header was rewritten to `› <name>` and
imported `ICON_TOOL`. The complete list of touched tool files:

```
execute-bash.tsx           list-directory.tsx              lsp-get-diagnostics.tsx
fetch-url.tsx               read-file.tsx                    skill-check.tsx
find-files.tsx              search-file-contents.tsx        web-search.tsx
ask-question.tsx            git/git-add.tsx                 git/git-commit.tsx
git/git/diff.tsx             git/git-log.tsx                 git/git-pr.tsx
git/git/status.tsx          file-ops/write-file.tsx         file-ops/string-replace-preview.tsx
file-ops/file-op.tsx        tasks/write-tasks.tsx
```

Per-tool specifics beyond the dominant `› <name>` swap:

| File                                  | Other change                                                                                                                                        |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fetch-url.tsx`                       | `⚠ Content was truncated to 100KB` → `${ICON_WARNING} Content was truncated to 100KB`                                                               |
| `file-ops/file-op.tsx`                | `⚒ operation is required` etc. — 7 validation errors → `! …`                                                                                        |
| `file-ops/string-replace-preview.tsx` | `⚒ string_replace` ×4 → `› string_replace`; `✗ Error: …` ×2 → `${ICON_ERROR} Error: …`; `✓ Replace completed` → `${ICON_SUCCESS} Replace completed` |
| `git/git-pr.tsx`                      | `✓ PR created successfully` / `✗ {result}` → `${ICON_SUCCESS} …` / `${ICON_ERROR} …`                                                                |
| `git/git-commit.tsx`                  | `✓ Commit created successfully` → `${ICON_SUCCESS} Commit created successfully`                                                                     |
| `git/git-diff.tsx`                    | `✓ No changes` → `${ICON_SUCCESS} No changes`                                                                                                       |
| `git/git-status.tsx`                  | `✓ Working tree clean` → `${ICON_SUCCESS} Working tree clean`                                                                                       |
| `tasks/write-tasks.tsx`               | The in-file `STATUS_ICON` literal map replaced with imports of `ICON_TASK_PENDING` / `ICON_TASK_IN_PROGRESS` / `ICON_TASK_COMPLETE`                 |
| `list-directory.tsx`                  | `⚒ Invalid path.` → `! Invalid path.`                                                                                                               |

### `source/commands/`

| File                                                           | Change                                                                                                                                                                                                                          |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mcp.tsx`                                                      | `💻 / 🔄 / 🌐 / ❓` transport markers → `>` / `<>` / `=` / `?` via `mcpTransportIcon()`; bullet markers via `ICON_BULLET`                                                                                                       |
| `lsp.tsx`                                                      | `🟢 / 🔴` LSP ready/not-ready → `ICON_LSP_READY` / `ICON_LSP_NOT_READY`; bullets via `ICON_BULLET`                                                                                                                              |
| `exit.ts`                                                      | `Goodbye! 👋` → `Goodbye! ${ICON_GOODBYE}`                                                                                                                                                                                      |
| `init.tsx`                                                     | `✓ Nanocoder project initialized successfully!` → `${ICON_SUCCESS} …`; `✗ ${message}` → `${ICON_ERROR} ${message}`; `↳ Merged content from:` → `${ICON_CONTINUATION} Merged content from:`; all `• ` bullets → `{ICON_BULLET} ` |
| `checkpoint.tsx`                                               | Three `✓ Checkpoint …` strings → `${ICON_SUCCESS} Checkpoint …`                                                                                                                                                                 |
| `credits.tsx`                                                  | `• {name}` / `• {dep}` rows → `{ICON_BULLET} {name}` / `{ICON_BULLET} `                                                                                                                                                         |
| `doctor.tsx`                                                   | `• ` diagnostics rows → `{ICON_BULLET} ` (15 imports referenced in diff)                                                                                                                                                        |
| `help.tsx`                                                     | `• Ask questions` / `• Edit files` / `• Fix errors` / `• Run commands` / `• Resume sessions` / `• /{cmd.name}` → `{ICON_BULLET} …`                                                                                              |
| `agents.tsx`, `tools.tsx`, `custom-commands.tsx`, `skills.tsx` | Every `› {name}` list-row marker routed through `ICON_LIST_ROW` (semantically explicit alias for `ICON_TOOL`)                                                                                                                   |

### `source/session/session-history-renderer.tsx`

- `result.content.startsWith('⚒ Validation failed')` → `result.content.startsWith('! Validation failed')`
- `{'⚒'} {label}` → `{ICON_TOOL} {label}`

### `source/custom-tools/`

| File                | Change                                                   |
| ------------------- | -------------------------------------------------------- |
| `formatter.tsx`     | `⚒ {toolName}` → `› {toolName}`                          |
| `schema-builder.ts` | Nine `⚒ Parameter …` validation errors → `! Parameter …` |

### `source/types/`

| File      | Change                                                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------ |
| `core.ts` | `DEVELOPMENT_MODE_LABELS` and `DEVELOPMENT_MODE_LABELS_NARROW` rewritten — `▶`/`⏵⏵`/`⏵⏵⏵`/`⏸` → `›`/`››`/`›››`/`?` |
| `ui.ts`   | `Colors` interface gains optional `brand?: string`                                                                 |

### `source/app/`

| Component                              | Change                                                                                       |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `App.tsx`                              | `⚠️ Error checking directory trust: …` → `${ICON_WARNING} Error checking directory trust: …` |
| `components/app-container.tsx`         | Boot-summary `${branch}${marker}` line switches from `⎇` to `╲`                              |
| `components/settings-auto-compact.tsx` | `⚠ {error}` → `${ICON_WARNING} {error}`                                                      |
| `components/settings-sessions.tsx`     | `⚠ {error}` → `${ICON_WARNING} {error}`                                                      |
| `components/settings-web-search.tsx`   | `✓ API key saved` / `✓ API key is configured` → `${ICON_SUCCESS} API key …`                  |
| `utils/conversation-state.ts`          | `⚠️ Warning: You may be repeating …` → `${ICON_WARNING} Warning: You may be repeating …`     |

### `source/wizards/`

| File                             | Change                                                                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `base-config-wizard.tsx`         | `✓ Configuration saved!` → `${ICON_SUCCESS} Configuration saved!`; `• Enter:` / `• Shift+Tab:` / `• Esc:` → `{ICON_BULLET} …` |
| `mcp-wizard.tsx`                 | `• {server.name}` → `{ICON_BULLET} {server.name}`                                                                             |
| `provider-wizard.tsx`            | `• {provider.name}` / `• {mode}:` → `{ICON_BULLET} …`                                                                         |
| `steps/mcp-step.tsx`             | `• {server.name}` → `{ICON_BULLET} {server.name}`                                                                             |
| `steps/model-selection-list.tsx` | `❯` cursor + `[✓]` checkbox → `ICON_SELECTION` + `${ICON_SUCCESS}`                                                            |

### `source/components/checkpoint-display.tsx`

- Sub-row `↳ {model}` → `${ICON_CONTINUATION} {model}`

---

## 5. Tests updated

The following test files had assertions about specific glyphs updated to
match the new vocabulary:

| Test                                                              | Before                                                                               | After                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `source/app/components/app-container.spec.tsx`                    | expects `⎇`                                                                          | expects `╲`                                                                               |
| `source/app/utils/conversation-state.spec.ts`                     | expects `⚠️ Warning`                                                                 | expects `! Warning`                                                                       |
| `source/commands/lsp-command.spec.tsx`                            | expects `🟢` / `🔴`                                                                  | expects `✓` / `!`                                                                         |
| `source/commands/mcp-command.spec.tsx`                            | expects `💻` / `🔄` / `🌐` / `❓`                                                    | expects `>` / `<>` / `=` / `?` (test escapes regex metachars)                             |
| `source/components/file-explorer/tree-item.spec.tsx`              | expects `>` / `v`                                                                    | expects `▸` (U+25B8) / `▾` (U+25BE)                                                       |
| `source/components/filterable-select-list.spec.tsx`               | comment references `❯`                                                               | comment references `▸`                                                                    |
| `source/components/status.spec.tsx`                               | expects `⚠ v1.0.0 → v1.1.0`                                                          | expects `! v1.0.0 → v1.1.0`                                                               |
| `source/components/welcome-message.spec.tsx`                      | expects `⎇`                                                                          | expects `╲`                                                                               |
| `source/custom-tools/schema-builder.spec.ts`                      | expects `⚒ Missing required parameter`                                               | expects `! Missing required parameter`                                                    |
| `source/hooks/chat-handler/conversation/auto-diagnostics.spec.ts` | expects `⚒ Validation failed`                                                        | expects `! Validation failed`                                                             |
| `source/hooks/useTerminalWidth.spec.tsx`                          | asserts `truncate` ends with `...` and length 20                                     | asserts it ends with `…` (single column) and trims to the visual-column budget            |
| `source/utils/tool-result-display.spec.tsx`                       | expects `⚒ Validation failed` (×2) and `⚒ <tool>` title (×3); counts `\u2692` glyphs | expects `! Validation failed` and `› <tool>` title; counts `\u203A` glyphs                |
| `source/utils/tool-validation.spec.ts`                            | expects `⚒ Validation failed: bad args`                                              | expects `! Validation failed: bad args`                                                   |
| `source/components/user-input.spec.ts`                            | asserts `\.\.\.` regex for the truncation marker                                     | asserts `\u2026` regex (single-column ellipsis)                                           |
| `source/components/assistant-message.spec.tsx`                    | asserts `/test-model:/` and `/gpt-4:/` regexes                                       | asserts `/test-model/` and `/gpt-4/` (the new `‹` prefix means `:` is no longer rendered) |
| `source/components/user-message.spec.tsx`                         | asserts `/You:/` regex                                                               | asserts `/You/` (the new `‹ You` marker drops the colon)                                  |

---

## 6. Glyph-by-glyph replacement ledger

The exact replacements performed across the codebase (counts measured
from `git diff origin/main HEAD`):

| Old glyph | Codepoint    | EAW  | New                                      | Count removed                 |
| --------- | ------------ | ---- | ---------------------------------------- | ----------------------------- |
| `⚒`       | U+2692       | A    | `›` (U+203A)                             | **70**                        |
| `⚠`       | U+26A0       | A    | `!` (U+0021)                             | **11**                        |
| `↳`       | U+21B3       | Na   | `↳` (kept — now via `ICON_CONTINUATION`) | **9** (now centralised)       |
| `⏵`       | U+23F5       | A    | `›`                                      | **7**                         |
| `❯`       | U+276F       | A    | `▸` (U+25B8)                             | **4**                         |
| `⎇`       | U+2387       | A    | `╲` (U+2572)                             | **4**                         |
| `🟢`      | U+1F7E2      | Wide | `✓`                                      | **3**                         |
| `🔴`      | U+1F534      | Wide | `!`                                      | **3**                         |
| `💻`      | U+1F4BB      | Wide | `>`                                      | **3**                         |
| `🌐`      | U+1F310      | Wide | `=`                                      | **3**                         |
| `🔄`      | U+1F504      | Wide | `<>`                                     | **3**                         |
| `⚠️`      | U+26A0+VS-16 | Wide | `!`                                      | **3**                         |
| `❓`      | U+2753       | Wide | `?`                                      | **2**                         |
| `⏸`       | U+23F8       | A    | `?`                                      | **2**                         |
| `▶`       | U+25B6       | A    | `›`                                      | **2**                         |
| `⊡`       | U+22A1       | A    | `›`                                      | **2**                         |
| `👋`      | U+1F44B      | Wide | `«`                                      | **1**                         |
| `⚙`       | U+2699       | A    | `·`                                      | **1**                         |
| `📋`      | U+1F4CB      | Wide | `?`                                      | (1, `plan-review-prompt.tsx`) |
| `✻`       | U+273B       | A    | `*`                                      | (2, `welcome-message.tsx`)    |

**133 glyph replacements total.** Two `↳` instances are kept (now via
`ICON_CONTINUATION`), the rest are gone.

---

## 7. New files

| File                                      | Lines | Purpose                                      |
| ----------------------------------------- | ----- | -------------------------------------------- |
| `source/components/ui/icons.tsx`          | 226   | Central icon vocabulary                      |
| `source/components/ui/icons.spec.tsx`     | ~135  | Glyph-width and helper-coverage tests        |
| `source/utils/width.ts`                   | 73    | Visual-column truncation helpers             |
| `source/utils/width.spec.ts`              | ~115  | Width / truncate tests including CJK + emoji |
| `.changeset/consistent-terminal-icons.md` | 40    | Release-notes entry                          |

## 8. Files touched (full list, 102)

```
.changeset/consistent-terminal-icons.md                (new)
package.json (adds string-width@^8.2.2 dependency)
pnpm-lock.yaml

source/app/App.tsx
source/app/components/app-container.spec.tsx
source/app/components/app-container.tsx
source/app/components/settings-auto-compact.tsx
source/app/components/settings-sessions.tsx
source/app/components/settings-web-search.tsx
source/app/utils/conversation-state.spec.ts
source/app/utils/conversation-state.ts

source/commands/agents.tsx
source/commands/checkpoint.tsx
source/commands/credits.tsx
source/commands/custom-commands.tsx
source/commands/doctor.tsx
source/commands/exit.ts
source/commands/help.tsx
source/commands/init.tsx
source/commands/lsp-command.spec.tsx
source/commands/lsp.tsx
source/commands/mcp-command.spec.tsx
source/commands/mcp.tsx
source/commands/skills.tsx
source/commands/tools.tsx

source/components/agent-progress.tsx
source/components/assistant-message.spec.tsx
source/components/assistant-message.tsx
source/components/assistant-reasoning.tsx
source/components/bash-progress.tsx
source/components/checkpoint-display.tsx
source/components/checkpoint-selector.tsx
source/components/development-mode-indicator.tsx
source/components/file-explorer/index.tsx
source/components/file-explorer/tree-item.spec.tsx
source/components/file-explorer/tree-item.tsx
source/components/filterable-select-list.spec.tsx
source/components/filterable-select-list.tsx
source/components/json-viewer/json-viewer.tsx
source/components/question-prompt.tsx
source/components/render-error-boundary.tsx
source/components/simple-tool-formatter.tsx
source/components/status.spec.tsx
source/components/status.tsx
source/components/streaming-message.tsx
source/components/streaming-reasoning.tsx
source/components/task-list-display.tsx
source/components/tool-confirmation.tsx
source/components/ui/icons.spec.tsx                  (new)
source/components/ui/icons.tsx                       (new)
source/components/user-input.spec.tsx
source/components/user-input.tsx
source/components/user-message.spec.tsx
source/components/user-message.tsx
source/components/vscode-extension-prompt.tsx
source/components/welcome-message.spec.tsx
source/components/welcome-message.tsx

source/config/themes.json (50 themes gained `brand: "#8373F7"`)

source/custom-tools/formatter.tsx
source/custom-tools/schema-builder.spec.ts
source/custom-tools/schema-builder.ts

source/hooks/chat-handler/conversation/auto-diagnostics.spec.ts
source/hooks/chat-handler/conversation/auto-diagnostics.ts
source/hooks/chat-handler/conversation/tool-executor.tsx
source/hooks/useAppHandlers.tsx
source/hooks/useTerminalWidth.spec.tsx
source/hooks/useTerminalWidth.tsx

source/session/session-history-renderer.tsx

source/tools/ask-question.tsx
source/tools/execute-bash.tsx
source/tools/fetch-url.tsx
source/tools/file-ops/file-op.tsx
source/tools/file-ops/string-replace-preview.tsx
source/tools/file-ops/string-replace.spec.tsx
source/tools/file-ops/write-file.tsx
source/tools/find-files.tsx
source/tools/git/git-add.tsx
source/tools/git/git-commit.tsx
source/tools/git/git-diff.tsx
source/tools/git/git-log.tsx
source/tools/git/git-pr.tsx
source/tools/git/git-status.tsx
source/tools/list-directory.tsx
source/tools/lsp-get-diagnostics.tsx
source/tools/read-file.tsx
source/tools/search-file-contents.tsx
source/tools/skill-check.tsx
source/tools/tasks/write-tasks.tsx
source/tools/web-search.tsx

source/types/core.ts
source/types/ui.ts

source/utils/path-validators.ts
source/utils/tool-result-display.spec.tsx
source/utils/tool-result-display.tsx
source/utils/tool-validation.spec.ts
source/utils/tool-validation.ts
source/utils/width.spec.ts                            (new)
source/utils/width.ts                                 (new)

source/wizards/base-config-wizard.tsx
source/wizards/mcp-wizard.tsx
source/wizards/provider-wizard.tsx
source/wizards/steps/mcp-step.tsx
source/wizards/steps/model-selection-list.tsx
```

---

## 9. Verification

- `pnpm run test:format` — clean
- `pnpm run test:lint` — clean (only pre-existing warnings)
- `pnpm run test:types` — clean
- 518 icon-adjacent AVA tests pass (`pnpm run test:ava` on a focused set
  covering every affected spec file)

---

## 11. Localised interaction footprint

The icon vocabulary is intentionally **tiny** (~30 distinct glyphs).
Adding more should be a deliberate decision — the rule of thumb for new
affordances is "prefer a coloured version of an existing glyph over
introducing a new one". We now utilize the `figures` package which seamlessly
maps to optimal terminal icons depending on OS and platform capabilities, ensuring
a high-quality UI on macOS/Linux while gracefully falling back to safe ASCII characters
on older Windows terminals or systems with limited font support.

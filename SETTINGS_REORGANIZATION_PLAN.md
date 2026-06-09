# Issue #471 — Re-organized Settings Menu + New UI for Settings Configuration

> **Source:** [Nano-Collective/nanocoder#471](https://github.com/Nano-Collective/nanocoder/issues/471)
> **Label:** enhancement
> **Assignee:** @grenkoca

---

## Background

Nanocoder (as of v1.25.2) exposes a `/settings` command in its TUI that allows users to configure a small set of parameters. The current implementation presents all configurable options as a flat, top-level list. In addition, several standalone slash-commands exist for one-time or infrequent interactive configuration: `/setup-config`, `/setup-mcp`, `/setup-providers`, `/ide`, `/copilot-login`, `/codex-login`, and `/tune`. While functional in isolation, these commands are scattered entry points that duplicate the role of a settings system and add noise to the slash-command namespace.

---

## Problem Statement

The current configuration surface has two related problems:

**`/settings` is too narrow and too flat:**
- Exposes only 5 of 20+ documented configuration parameters
- Presents all options as an unstructured top-level list with no grouping
- Provides no free-text input for numeric or path-based settings — only enumerated choices
- Lacks input validation
- Cannot accommodate planned future features (custom keybinds, theme color editing, plugin management) without becoming unwieldy

**Orphan slash-commands fragment the configuration experience:**
- `/setup-config`, `/setup-mcp`, `/setup-providers`, `/ide`, `/copilot-login`, `/codex-login`, and `/tune` are interactive setup flows with no connection to `/settings`
- Users have no single, discoverable place to configure the application
- The slash-command namespace conflates one-time setup with ongoing workflow actions (e.g. `compact`, `export`), making both harder to find

---

## Motivation

As nanocoder grows, users need a single, reliable place to configure the application without directly editing `.json` config files. Consolidating all interactive configuration under `/settings` and restructuring it as a navigable tree:

- Makes the full configuration surface discoverable in one place
- Eliminates orphan commands and clarifies the purpose of the slash-command namespace
- Prevents misconfiguration by offering validation at the point of input
- Provides a scalable foundation for future configurable features
- Aligns with the project's local-first philosophy by removing the need for manual file editing

The guiding design principle agreed upon in discussion: **anything that needs to be written to `preferences` or `agent.config` belongs in `/settings`**. Slash-commands should be reserved for dedicated workflow actions.

---

## Implementation Plan

### 1. Refactor `/settings` into a nested, navigable menu

Replace the flat list with a multi-level hierarchy. By design choice, the depth should be three levels AT MOST. The first level displays broad categories; selecting a category opens a sub-menu. Every sub-menu must provide a clear path back to the top-level settings to prevent users from getting stranded in deep wizards (e.g. the MCP configuration flow).

Proposed top-level categories and navigation behavior:

```
/settings
 │
 ├─ Appearance
 │   ├── Theme            - Change color scheme
 │   ├── Title Shape      - Customize box title styles
 │   └── Nanocoder Shape  - Change welcome banner font
 │
 ├─ Input
 │   ├── Paste Threshold  - Set single-line paste character limit
 │   └── (custom keybinds — future standalone PR)
 │
 ├─ Behavior
 │   ├── Notifications    - Desktop notification preferences
 │   ├── Auto-Compact     - Auto-compact settings (enabled, threshold, mode, notify)
 │   ├── Sessions         - Session management (autoSave, saveInterval, maxSessions, etc.)
 │   ├── Default Mode     - Initial development mode for new sessions
 │   └── Reasoning Traces - Expand/collapse reasoning traces by default
 │
 ├─ Providers
 │   ├── (provider-specific overrides; absorbs /setup-providers, /copilot-login, /codex-login)
 │   └── Tool Auto-Approval - Configure alwaysAllow tool lists
 │
 ├─ MCPs
 │   └── (MCP server configuration; absorbs /setup-mcp)
 │
 ├─ Web Search
 │   └── (web search provider / behavior settings)
 │
 ├─ Environment
 │   └── (read-only display of active environment variables)
 │
 └─ Advanced
     └── (logging, model parameters, environment overrides, feature .md paths;
          absorbs /setup-config, /tune, /ide)
```

**Navigation requirements (per @will-lamerton):**
- Every sub-menu and wizard screen must show a visible "back" affordance returning to the parent level
- No screen should be a dead end — the user must always be able to reach the top-level settings without quitting and re-entering `/settings`
- Multi-step wizards (e.g. MCP setup) should preserve progress if the user navigates away and returns

> **Note on Advanced:** This category contains settings intended for Nanocoder developers or settings that could break the configuration if misused (model parameters, environment overrides, logging paths). Display a visible warning on entry.

To orient the user to their current location in the nested menu, leverage the box title in settings. Currently, it displays "Settings" with decorative characters on the side (user decided via "Title Shape" option). When navigating through menus, expand that with the subdirectory path separated with interpuncts, like so:

Top level:
```
╭ Settings ╮
╭─────────────...
```

In "Appearance":
```
╭ Settings · Appearance ╮
╭─────────────...
```

and the bottom text changes from

`Enter to select, Esc to exit`

to:

`Enter to select, Shift+Tab to go back, Esc to exit`


Finally, the second-level submenus should buffer settings until the user either exits settings or returns to the top-level menu, at which point the user is prompted to Keep or Discard the settings. The `Appearance` submenu is an exception, and should immediately render a preview of the options as the user selects them (but also prompt keep / discard on return to main menu or exiting settings).

### 2. Migrate orphan slash-commands into `/settings`

The following commands should have their **entry points** migrated to the appropriate `/settings` sub-menu. Their existing interactive UIs should be preserved — only the invocation path changes.

| Command | Migrate to |
|---|---|
| `/setup-config` | Advanced |
| `/setup-mcp` | MCPs |
| `/setup-providers` | Providers |
| `/ide` | Advanced |
| `/copilot-login` | Providers |
| `/codex-login` | Providers |
| `/tune` | Advanced |

After migration, these slash-commands should either be removed or aliased to their new location with a deprecation notice. Slash-commands should be reserved going forward for workflow actions only (e.g. `compact`, `export`).

### 3. Add free-text input for non-enumerated settings

- Multiple-choice / toggle input remains appropriate for settings with a fixed set of valid values (e.g., banner font, theme selection).
- Settings with numeric or filepath values (e.g., paste threshold, default context size, custom paths) should expose a text input field.

### 4. Add input validation

- Validate all user input before writing to config.
- For numeric fields: enforce type and range constraints.
- For filepath fields: check path existence or warn if the path is invalid.
- Display clear, inline error messages on invalid input without exiting the settings context.

### 5. Add Environment Variables (Read-Only) Display

A new `Environment` category in the top-level settings menu displays all detected `NANOCODER_*` environment variables in a read-only list. This gives users visibility into which env vars are active and their current values, without allowing edits (since env vars are set externally). Sensitive values (API keys, tokens) should be masked.

### 6. Audit and map all configurable parameters

Before implementation, audit `docs/configuration/index.md` to produce a definitive list of:
- Which parameters will be surfaced in the TUI settings UI
- Which will remain config-file-only (if any), with rationale
- Which category each parameter belongs to

Commit this as `docs/settings-menu-map.md` alongside the code changes.

---

## Expected Outcomes

- `/settings` is the single entry point for all interactive configuration in nanocoder
- The menu is organized into at least 7 top-level categories with navigable sub-menus
- All 20+ documented configuration parameters are accessible via TUI (or explicitly excluded with rationale)
- Numeric and filepath settings accept free-text input with validation; enumerated settings retain multiple-choice behavior
- Invalid inputs produce clear error messages; valid inputs are persisted to `preferences` / `agent.config`
- All 7 orphan slash-commands are accessible via their new `/settings` home; the slash-command namespace is reserved for workflow actions
- Environment variables are displayed read-only for user awareness
- Back-navigation is available at every level — no dead ends in any wizard or sub-menu
- The settings architecture can accommodate planned future features (keybinds, theme color editing, plugin management) without structural changes

---

## Criteria for Success

| # | Criterion |
|---|-----------|
| 1 | `/settings` displays a multi-level navigable menu matching the proposed category structure |
| 2 | All parameters listed in `docs/configuration/index.md` are either accessible via TUI or documented as intentionally excluded |
| 3 | Text input is available for all numeric and filepath-type settings |
| 4 | Input validation rejects invalid values and displays an actionable inline error message |
| 5 | Valid changes are persisted to `preferences` / `agent.config` without requiring a restart (or restart behavior is explicitly documented) |
| 6 | The `Advanced` category is visually distinguished and carries a warning about potentially breaking changes |
| 7 | All 7 orphan slash-commands (`/setup-config`, `/setup-mcp`, `/setup-providers`, `/ide`, `/copilot-login`, `/codex-login`, `/tune`) are accessible from within `/settings` |
| 8 | Orphan slash-commands are removed or emit a deprecation notice directing users to `/settings` |
| 9 | Every sub-menu and wizard screen has a functional back-navigation path to the top-level settings |
| 10 | No regression in the 5 settings previously accessible via `/settings` |
| 11 | `docs/settings-menu-map.md` is committed documenting parameter-to-category assignments |
| 12 | Environment variables are displayed read-only in the `Environment` category with sensitive values masked |

---

## Implementation Phases

### Phase A: Menu Infrastructure & Navigation

**Goal:** Build the nested menu scaffolding — no new settings yet, just the navigation shell.

**Files to create/modify:**

1. **`source/app/components/settings-selector.tsx`** — Major refactor. Replace the flat `SettingsStep` union with a hierarchical type system:
   - Define `SettingsCategory` enum: `appearance`, `input`, `behavior`, `providers`, `mcp`, `webSearch`, `environment`, `advanced`
   - Define `SettingsPath` type: array of strings representing navigation depth, e.g. `['settings']`, `['settings', 'appearance']`, `['settings', 'appearance', 'theme']`
   - Create a `SettingsNavigation` component that renders the current menu level based on path
   - Implement breadcrumb title generation: `Settings · Appearance` using interpunct separator
   - Implement the Keep/Discard prompt when returning from sub-menus to top-level
   - Wire up Shift+Tab back-navigation at all levels

2. **`source/app/components/settings-menu-types.ts`** (new) — Shared types and constants:
   - `SettingsCategory` enum with labels and descriptions
   - `SettingsMenuItem` interface for menu items
   - `SettingsPath` type
   - Category-to-menu-items mapping function
   - Breadcrumb title builder utility

3. **`source/app/components/settings-keep-discard-prompt.tsx`** (new) — Simple prompt component:
   - Shows "Keep changes?" / "Discard changes?" when user navigates back from a sub-menu with unsaved changes
   - Uses SelectInput with two options

**Key patterns to reuse:**
- `TitledBoxWithPreferences` from `source/components/ui/titled-box.tsx` for all menu boxes
- `useTheme()` hook from `source/hooks/useTheme.ts` for colors
- `useResponsiveTerminal()` from `source/hooks/useTerminalWidth.tsx` for narrow terminal layouts
- `SelectInput` from `ink-select-input` for menu navigation
- Existing `SettingsMainMenu` pattern for layout structure

**Verification:**
- Run `/settings` and verify top-level categories render
- Navigate into any category and verify breadcrumb title updates
- Press Shift+Tab and verify return to top-level
- Press Esc and verify exit from settings

---

### Phase B: Migrate Existing Settings into Categories

**Goal:** Move the 5 existing settings (Theme, Title Shape, Nanocoder Shape, Paste Threshold, Notifications) into the new category structure.

**Files to modify:**

1. **`source/app/components/settings-selector.tsx`** — Refactor existing panels:
   - Move Theme, Title Shape, Nanocoder Shape panels under `Appearance` category
   - Move Paste Threshold under `Input` category
   - Move Notifications under `Behavior` category
   - Appearance sub-menu: implement live-preview behavior (existing Theme/Title Shape/Nanocoder Shape panels already do this)
   - All other sub-menus: implement buffering + Keep/Discard on return

2. **`source/app/components/settings-menu-types.ts`** — Add menu item definitions for migrated settings

**Key patterns to reuse:**
- Existing `SettingsThemePanel`, `SettingsTitleShapePanel`, `SettingsNanocoderShapePanel`, `SettingsPasteThresholdPanel`, `SettingsNotificationsPanel` — mostly unchanged, just re-parented
- `useTheme()` context for theme preview (already used)
- `useTitleShape()` context for title shape preview (already used)
- `preferences.ts` getter/setter functions (already used)

**Verification:**
- Run `/settings` → Appearance → Theme: verify live preview works
- Run `/settings` → Input → Paste Threshold: verify selection works
- Run `/settings` → Behavior → Notifications: verify toggles work
- Verify Keep/Discard prompt appears when navigating back with changes
- Verify no regression in any of the 5 existing settings

---

### Phase C: New Settings — Behavior, Input (Free-Text), Validation

**Goal:** Add new settings with free-text input and validation.

**New settings to implement:**

| Setting | Category | Type | Source |
|---------|----------|------|--------|
| Auto-Compact (enabled, threshold, mode, notify) | Behavior | Mixed (toggle + select + number) | `agents.config.json` → `nanocoder.autoCompact` |
| Sessions (autoSave, saveInterval, maxSessions, maxMessages, retentionDays, directory) | Behavior | Mixed (toggle + number + text) | `agents.config.json` → `nanocoder.sessions` |
| Default Mode | Behavior | Select (normal, auto-accept, yolo, plan) | `agents.config.json` → `nanocoder.defaultMode` |
| Reasoning Traces | Behavior | Toggle | `nanocoder-preferences.json` → `reasoningExpanded` |
| Paste Threshold (free-text) | Input | Number (free-text with validation) | `nanocoder-preferences.json` → `nanocoder.paste.singleLineThreshold` |

**Files to create/modify:**

1. **`source/app/components/settings-auto-compact.tsx`** (new) — Auto-compact settings panel:
   - Toggle for enabled/disabled
   - Number input for threshold (50–95 range, validated)
   - Select for mode (default, conservative, aggressive)
   - Toggle for notifyUser
   - Uses `TextInput` component for number input
   - Validates range before saving

2. **`source/app/components/settings-sessions.tsx`** (new) — Session management panel:
   - Toggle for autoSave
   - Number inputs for saveInterval, maxSessions, maxMessages, retentionDays
   - Text input for directory path
   - Validates minimum values (saveInterval ≥ 1000, others ≥ 1)
   - Path validation for directory

3. **`source/app/components/settings-default-mode.tsx`** (new) — Default mode selector:
   - SelectInput with 4 options (normal, auto-accept, yolo, plan)
   - Shows descriptions for each mode

4. **`source/app/components/settings-reasoning-traces.tsx`** (new) — Simple toggle:
   - Toggle reasoningExpanded preference
   - Calls `loadPreferences()`/`savePreferences()` from `preferences.ts`

5. **`source/app/components/settings-paste-threshold.tsx`** (modify) — Convert from SelectInput to TextInput:
   - Accept free-text numeric input
   - Validate: must be positive integer
   - Show inline error on invalid input

6. **`source/config/preferences.ts`** (modify) — Add new getter/setter functions:
   - `getAutoCompactConfig()` / `updateAutoCompactConfig()`
   - `getSessionConfig()` / `updateSessionConfig()`
   - `getDefaultMode()` / `updateDefaultMode()`
   - `getReasoningExpanded()` / `updateReasoningExpanded()`

7. **`source/config/index.ts`** (modify) — Export new config loaders for settings panels to read current values

8. **`source/app/components/settings-menu-types.ts`** — Add menu items for new settings

**Key patterns to reuse:**
- `TextInput` from `source/components/text-input.tsx` — already used in provider-step.tsx and mcp-step.tsx for free-text input
- `SelectInput` from `ink-select-input` — for enumerated choices
- `loadPreferences()`/`savePreferences()` from `source/config/preferences.ts` — pattern for read/write
- `getAppConfig()` from `source/config/index.ts` — for reading current auto-compact and session config
- Validation patterns from `source/config/index.ts` (`validateThreshold`, `validateMode`)

**Verification:**
- Set Auto-Compact threshold to invalid value (e.g., 10) — verify error message
- Set Auto-Compact threshold to valid value (e.g., 75) — verify save
- Change Default Mode — verify persistence
- Toggle Reasoning Traces — verify preference saved
- Enter free-text paste threshold — verify validation and save

---

### Phase D: Providers, MCPs, Web Search, Environment, Advanced Categories

**Goal:** Add the remaining categories, migrating orphan commands and adding new settings.

**New settings to implement:**

| Setting | Category | Type | Source |
|---------|----------|------|--------|
| Provider Configuration wizard | Providers | Wizard entry point | Absorbs `/setup-providers` |
| Copilot Login | Providers | Wizard entry point | Absorbs `/copilot-login` |
| Codex Login | Providers | Wizard entry point | Absorbs `/codex-login` |
| Tool Auto-Approval | Providers | List display/edit | `agents.config.json` → `nanocoder.alwaysAllow` and `nanocoder.nanocoderTools.alwaysAllow` |
| MCP Server Configuration | MCPs | Wizard entry point | Absorbs `/setup-mcp` |
| Web Search API Key | Web Search | Text input (masked) | `agents.config.json` → `nanocoder.nanocoderTools.webSearch.apiKey` |
| Environment Variables | Environment | Read-only list | `process.env` (NANOCODER_* vars) |
| Config File Editor | Advanced | Wizard entry point | Absorbs `/setup-config` |
| IDE Connection | Advanced | Wizard entry point | Absorbs `/ide` |
| Tune (Model Parameters) | Advanced | Wizard entry point | Absorbs `/tune` |

**Files to create/modify:**

1. **`source/app/components/settings-providers.tsx`** (new) — Providers sub-menu:
   - Menu items: "Configure Providers" (launches config wizard), "GitHub Copilot Login", "ChatGPT Codex Login", "Tool Auto-Approval"
   - On selecting a wizard entry, transition to the existing wizard component
   - Reuse `CopilotLogin` from `source/commands/copilot-login.tsx`
   - Reuse `CodexLogin` from `source/commands/codex-login.tsx`

2. **`source/app/components/settings-mcp.tsx`** (new) — MCPs sub-menu:
   - Menu item: "Configure MCP Servers" (launches MCP wizard)
   - Reuse existing MCP wizard mode

3. **`source/app/components/settings-web-search.tsx`** (new) — Web Search sub-menu:
   - Text input for Brave Search API key (masked)
   - Read current key from `getAppConfig().nanocoderTools?.webSearch?.apiKey`
   - Save to `agents.config.json`

4. **`source/app/components/settings-environment.tsx`** (new) — Environment Variables display:
   - Scan `process.env` for all `NANOCODER_*` keys
   - Display as a scrollable read-only list
   - Mask sensitive values (anything containing "KEY", "TOKEN", "SECRET", "PASSWORD" in the value)
   - Show source (shell env vs .env file) if detectable
   - No edit capability — purely informational

5. **`source/app/components/settings-advanced.tsx`** (new) — Advanced sub-menu:
   - Display warning banner on entry (yellow/red styled box)
   - Menu items: "Edit Config Files" (setup-config), "Connect IDE" (ide), "Tune Model" (tune)
   - On selecting, launch the corresponding existing wizard/mode

6. **`source/app/components/settings-tool-approval.tsx`** (new) — Tool Auto-Approval panel:
   - Display current alwaysAllow list
   - Allow adding/removing tool names
   - Save to `agents.config.json`

7. **`source/app/components/settings-selector.tsx`** — Wire up all new category sub-menus

8. **`source/app/components/settings-menu-types.ts`** — Add all new menu items

**Key patterns to reuse:**
- `CopilotLogin` component from `source/commands/copilot-login.tsx`
- `CodexLogin` component from `source/commands/codex-login.tsx`
- `ConfigWizard` from existing wizard mode (triggered by `onEnterConfigWizardMode`)
- `McpWizard` from existing wizard mode (triggered by `onEnterMcpWizardMode`)
- `TuneSelector` from `source/app/components/tune-selector.tsx`
- `IDESelector` from existing IDE mode
- `setup-config.tsx` existing UI for config file editing
- `TextInput` with `mask="*"` for API key input
- `getAppConfig()` from `source/config/index.ts` for reading current config

**Verification:**
- Navigate to Providers → "Configure Providers" — verify existing wizard launches
- Navigate to Providers → "GitHub Copilot Login" — verify login flow starts
- Navigate to MCPs → "Configure MCP Servers" — verify MCP wizard launches
- Navigate to Web Search — verify API key input works
- Navigate to Environment — verify all NANOCODER_* vars listed, sensitive values masked
- Navigate to Advanced — verify warning banner displays
- Navigate to Advanced → "Tune Model" — verify TuneSelector launches

---

### Phase E: Deprecate Orphan Slash-Commands

**Goal:** Update the 7 orphan slash-commands to redirect to `/settings` with a deprecation notice.

**Files to modify:**

1. **`source/app/utils/app-util.ts`** — Modify `SPECIAL_COMMANDS` handling:
   - For `setup-providers`, `setup-mcp`, `settings`, `ide`, `tune`: instead of directly entering the wizard mode, first enter settings mode and navigate to the appropriate sub-menu
   - OR: keep the direct behavior but show a deprecation warning message before launching

2. **`source/commands/setup-config.tsx`** — Add deprecation notice to handler
3. **`source/commands/setup-mcp.tsx`** — Add deprecation notice to handler
4. **`source/commands/setup-providers.tsx`** — Add deprecation notice to handler
5. **`source/commands/ide.tsx`** — Add deprecation notice to handler
6. **`source/commands/copilot-login.tsx`** — Add deprecation notice to command registration
7. **`source/commands/codex-login.tsx`** — Add deprecation notice to command registration
8. **`source/commands/tune.ts`** — Add deprecation notice to handler

**Deprecation approach:** Soft deprecation. Commands still work but print a warning:
```
⚠️  This command is deprecated. Use /settings instead.
   This command will be removed in a future release.
```

**Key patterns to reuse:**
- `logWarning` from `source/utils/message-queue.ts` for deprecation messages
- Existing command handler pattern (stub commands)

**Verification:**
- Run `/setup-config` — verify deprecation notice + command still works
- Run `/setup-mcp` — verify deprecation notice + command still works
- Run `/setup-providers` — verify deprecation notice + command still works
- Run `/tune` — verify deprecation notice + command still works
- Run `/ide` — verify deprecation notice + command still works
- Run `/copilot-login` — verify deprecation notice + command still works
- Run `/codex-login` — verify deprecation notice + command still works

---

### Phase F: Parameter Audit & Documentation

**Goal:** Create the definitive parameter-to-category mapping document.

**Files to create:**

1. **`docs/settings-menu-map.md`** — Complete mapping of all configurable parameters:

| Parameter | Type | Category | Sub-Menu | Editable via TUI | Source File | Notes |
|-----------|------|----------|----------|-------------------|-------------|-------|
| `selectedTheme` | select | Appearance | Theme | ✅ | preferences | |
| `titleShape` | select | Appearance | Title Shape | ✅ | preferences | |
| `nanocoderShape` | select | Appearance | Nanocoder Shape | ✅ | preferences | |
| `paste.singleLineThreshold` | number | Input | Paste Threshold | ✅ | preferences | Free-text input |
| `notifications.*` | toggle | Behavior | Notifications | ✅ | preferences | |
| `autoCompact.*` | mixed | Behavior | Auto-Compact | ✅ | agents.config.json | |
| `sessions.*` | mixed | Behavior | Sessions | ✅ | agents.config.json | |
| `defaultMode` | select | Behavior | Default Mode | ✅ | agents.config.json | |
| `reasoningExpanded` | toggle | Behavior | Reasoning Traces | ✅ | preferences | |
| providers | wizard | Providers | Configure Providers | ✅ | agents.config.json | Wizard entry |
| copilot credentials | wizard | Providers | Copilot Login | ✅ | agents.config.json | Wizard entry |
| codex credentials | wizard | Providers | Codex Login | ✅ | agents.config.json | Wizard entry |
| `alwaysAllow` | list | Providers | Tool Auto-Approval | ✅ | agents.config.json | |
| `nanocoderTools.alwaysAllow` | list | Providers | Tool Auto-Approval | ✅ | agents.config.json | |
| MCP servers | wizard | MCPs | Configure MCP Servers | ✅ | agents.config.json | Wizard entry |
| `nanocoderTools.webSearch.apiKey` | text | Web Search | API Key | ✅ | agents.config.json | Masked input |
| `NANOCODER_*` env vars | read-only | Environment | (all) | ❌ | process.env | Read-only display |
| `tune.*` | wizard | Advanced | Tune Model | ✅ | preferences | Wizard entry |
| Config file paths | wizard | Advanced | Edit Config Files | ✅ | filesystem | Wizard entry |
| IDE connection | wizard | Advanced | Connect IDE | ✅ | agents.config.json | Wizard entry |
| `NANOCODER_LOG_LEVEL` | env var | — | — | ❌ | environment | Config-file only |
| `NANOCODER_LOG_TO_FILE` | env var | — | — | ❌ | environment | Config-file only |
| `NANOCODER_LOG_DIR` | env var | — | — | ❌ | environment | Config-file only |
| `NANOCODER_CONFIG_DIR` | env var | — | — | ❌ | environment | Config-file only |
| `NANOCODER_DATA_DIR` | env var | — | — | ❌ | environment | Config-file only |
| `NANOCODER_PROVIDERS` | env var | — | — | ❌ | environment | Config-file only |
| `NANOCODER_MCPSERVERS` | env var | — | — | ❌ | environment | Config-file only |
| `contextWindow` per provider | number | — | — | ❌ | agents.config.json | Too granular for TUI |
| `requestTimeout` per provider | number | — | — | ❌ | agents.config.json | Too granular for TUI |
| `connectionPool` per provider | object | — | — | ❌ | agents.config.json | Too granular for TUI |
| `disableTools` per provider | toggle | — | — | ❌ | agents.config.json | Too granular for TUI |
| LSP server configs | object | — | — | ❌ | agents.config.json | Too granular for TUI |

**Verification:**
- Review document for completeness against `docs/configuration/index.md`
- Every documented parameter should appear in the table
- Excluded parameters should have clear rationale

---

## Files to Modify (Summary)

### New Files
| File | Purpose |
|------|---------|
| `source/app/components/settings-menu-types.ts` | Shared types, constants, and menu definitions |
| `source/app/components/settings-keep-discard-prompt.tsx` | Keep/Discard prompt component |
| `source/app/components/settings-auto-compact.tsx` | Auto-compact settings panel |
| `source/app/components/settings-sessions.tsx` | Session management panel |
| `source/app/components/settings-default-mode.tsx` | Default mode selector |
| `source/app/components/settings-reasoning-traces.tsx` | Reasoning traces toggle |
| `source/app/components/settings-providers.tsx` | Providers sub-menu |
| `source/app/components/settings-mcp.tsx` | MCPs sub-menu |
| `source/app/components/settings-web-search.tsx` | Web Search settings panel |
| `source/app/components/settings-environment.tsx` | Environment variables display |
| `source/app/components/settings-advanced.tsx` | Advanced sub-menu |
| `source/app/components/settings-tool-approval.tsx` | Tool auto-approval panel |
| `docs/settings-menu-map.md` | Parameter-to-category mapping document |

### Modified Files
| File | Changes |
|------|---------|
| `source/app/components/settings-selector.tsx` | Major refactor: hierarchical navigation, breadcrumb titles, Keep/Discard |
| `source/config/preferences.ts` | Add getter/setter functions for new settings |
| `source/config/index.ts` | Export new config loaders |
| `source/app/utils/app-util.ts` | Update SPECIAL_COMMANDS handling for deprecation |
| `source/commands/setup-config.tsx` | Add deprecation notice |
| `source/commands/setup-mcp.tsx` | Add deprecation notice |
| `source/commands/setup-providers.tsx` | Add deprecation notice |
| `source/commands/ide.tsx` | Add deprecation notice |
| `source/commands/copilot-login.tsx` | Add deprecation notice |
| `source/commands/codex-login.tsx` | Add deprecation notice |
| `source/commands/tune.ts` | Add deprecation notice |
| `source/app/components/modal-selectors.tsx` | Minor: may need to pass new props for settings sub-navigation |
| `source/commands/settings.ts` | Update description text |

### Reused Components & Utilities
| Path | Usage |
|------|-------|
| `source/components/ui/titled-box.tsx` | `TitledBoxWithPreferences` — all menu boxes |
| `source/components/text-input.tsx` | `TextInput` — free-text input for numbers, paths, API keys |
| `source/hooks/useTheme.ts` | `useTheme()` — color theming |
| `source/hooks/useTerminalWidth.tsx` | `useResponsiveTerminal()` — narrow terminal layouts |
| `source/hooks/useTitleShape.ts` | `useTitleShape()` — title shape context |
| `source/config/preferences.ts` | `loadPreferences()`, `savePreferences()`, and all getter/setters |
| `source/config/index.ts` | `getAppConfig()`, `reloadAppConfig()` |
| `source/commands/copilot-login.tsx` | `CopilotLogin` component — reused in Providers sub-menu |
| `source/commands/codex-login.tsx` | `CodexLogin` component — reused in Providers sub-menu |
| `source/app/components/tune-selector.tsx` | `TuneSelector` — reused in Advanced sub-menu |
| `source/utils/message-queue.ts` | `logWarning` — deprecation notices |
| `ink-select-input` | `SelectInput` — menu navigation throughout |

---

## UPDATE LOG:

[x] 2025-01-XX — Plan created and approved
[x] Phase A: Menu Infrastructure & Navigation — Implemented
    - Created `settings-menu-types.ts` with category definitions, path types, and breadcrumb builder
    - Created `settings-keep-discard-prompt.tsx` for unsaved changes prompt
    - Refactored `settings-selector.tsx` with hierarchical navigation (3-level path system)
    - Added Shift+Tab back-navigation at all levels
    - Added breadcrumb titles ("Settings · Appearance · Theme")
    - Added Environment panel with read-only NANOCODER_* env var display (sensitive values masked)
    - Added placeholder panels for unimplemented settings
[x] Phase B: Migrate Existing Settings into Categories — Implemented
    - Theme, Title Shape, Nanocoder Shape → Appearance category
    - Paste Threshold → Input category
    - Notifications → Behavior category
    - All existing panels preserved with full functionality
[x] Phase C: New Settings — Behavior, Validation — Implemented
    - Created `config-writer.ts` utility for writing to agents.config.json
    - Auto-Compact panel (Behavior): toggles + threshold input with range validation (50-95)
    - Sessions panel (Behavior): toggles + numeric inputs with min-value validation
    - Default Mode panel (Behavior): select from 4 modes
    - Reasoning Traces panel (Behavior): simple toggle
    - Added `getReasoningExpanded()`/`updateReasoningExpanded()` to preferences.ts
[x] Phase D: Providers, MCPs, Web Search, Advanced — Partially Implemented
    - Tool Auto-Approval panel (Providers): read-only display of alwaysAllow lists
    - Web Search panel: API key input with masking
    - Placeholder panels remain for wizard entry points (configure providers, MCP servers, IDE, tune, config files)
[x] Phase E: Deprecate Orphan Slash-Commands — Implemented
    - Updated descriptions for all 7 orphan commands with deprecation banners
    - Added runtime logWarning for /setup-config
    - Updated lazy-registry inline descriptions
    - Updated /settings description to reflect expanded scope
[x] Phase F: Parameter Audit & Documentation — Implemented
    - Created `docs/settings-menu-map.md` with complete parameter-to-category mapping
    - Documented rationale for all excluded parameters
    - Documented future planned parameters

[ ]
...

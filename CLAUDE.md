# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Build and run
pnpm run build          # Compile TypeScript to dist/ with executable permissions
pnpm run build:credits  # Regenerate contributors.json from git history (CI/release only)
pnpm run start          # Run the compiled application
pnpm run dev            # Watch mode compilation (tsc --watch)

# Testing (run before committing)
pnpm run test:all       # Full suite: format, lint, types, AVA tests, knip, audit, security

# Individual test commands
pnpm run test:ava source/path/to/file.spec.ts  # Run single test file
pnpm run test:ava:coverage                      # Tests with coverage
pnpm run test:types                             # TypeScript checking only
pnpm run test:format                            # Biome format check
pnpm run test:lint                              # Biome lint check
pnpm run test:lint:fix                          # Auto-fix lint/format issues
pnpm run test:knip                              # Unused code detection, plus a production pass that flags files only specs import
pnpm run test:benchmark                         # Run model benchmarks
pnpm run test:agent-eval                        # Agent evaluation harness (steps/tokens/cost per task; needs a model, not part of test:all)

# VS Code extension
pnpm run build:vscode   # Build extension to assets/nanocoder-vscode.vsix
```

## Project Overview

Nanocoder is a React-based CLI coding agent built with Ink.js that provides local-first AI assistance with multiple provider support (Ollama, OpenRouter, any OpenAI-compatible API).

**Entry point**: `source/cli.tsx` → dynamic import of `source/app/load-tui-renderer.ts` → `source/app/render-tui.tsx`, which renders `App` from `source/app/App.tsx`. `cli.tsx` has fast paths that never load Ink: `--help`/`--version`, the `storage`, `daemon`, `verify`, `skills`, `config`, `trust`, `init` and `completion` subcommands, and copilot/codex device-flow login. `--acp` starts the ACP server (`source/acp/acp-server.ts`), and `--plain` runs a non-Ink shell (`source/plain/shell.ts`) for CI / non-TTY environments.

## Architecture

### Core Application Flow

1. **Directory Trust Check** (`useDirectoryTrust`) - First-run security disclaimer for new directories
2. **App Initialization** (`useAppInitialization`) - Creates LLM client, loads MCP servers, loads custom commands
3. **Central State** (`useAppState`) - Single source of truth for 50+ state variables
4. **Chat/Tool Flow** - User input → LLM → tool confirmation → execution → response

### Key Directories

- `source/hooks/` - React hooks: `useAppState` (central state), `useModeHandlers`, `useAppHandlers` (orchestrator), plus `chat-handler/useChatHandler` (LLM interaction) with the conversation loop and tool executor in `chat-handler/conversation/`
- `source/app/` - `App.tsx` plus app-internal helpers (`utils/app-util.ts`, `utils/command-dispatcher.ts`, `utils/conversation-state.ts`, prompt sections, orchestration hooks in `app/hooks/`)
- `source/ai-sdk-client/` - Wrapper over Vercel AI SDK: chat handler, providers, converters, tool helpers, error handling
- `source/tools/` - Built-in tools (file ops, bash, search, web fetch). Registered in `source/tools/tool-manager.ts`; file editors are `string_replace`, `diff_edit` and `write_file` (in `source/tools/file-ops/`)
- `source/components/` - Ink UI components
- `source/config/` - Configuration loading and preferences
- `source/commands/` - Built-in slash commands (`/model`, `/provider`, `/clear`, etc.)
- `source/custom-commands/` - User-defined markdown commands from `.nanocoder/commands/`
- `source/mcp/` - Model Context Protocol server integration
- `source/tool-calling/` - XML/text tool-call parsers for the fallback path (non-native-tool models)
- `source/services/` - Checkpoint manager, bash executor, file snapshots, lifecycle hooks (user shell commands run at fixed points in the agent loop)
- `source/usage/` - Token/cost usage: breakdown calculator, per-response usage + cost builder (provider-reported tokens priced via models.dev), compact formatters for the per-response indicator, context-window percentage from provider-reported usage. Lifetime usage history lives in `source/stats/`
- `source/session/` - Chat session persistence (autosave / resume)
- `source/schedule/` - Cron expression helpers (validate, next run, human-readable labels) used by `/skills schedule` and skill cron subscriptions
- `source/subagents/` - Subagent executor (delegated agent runs)
- `source/auth/` - Copilot / Codex device-flow login
- `source/lsp/` - Language server client integration
- `source/wizards/` - Interactive setup flows (config, MCP, providers)
- `source/plain/` - Non-Ink CLI shell used by `--plain`
- `source/agent-loop/` - Shared, Ink-free agent turn engine (`runTurnEngine`): one iterative loop owning the model call, text tool-call parsing, retry guards, auto-compaction and turn limits. Frontends plug in through an adapter; `--plain`, ACP and subagents run on it, and the TUI loop is moving onto it
- `source/skills/` - Unified skill primitive: loaders (bundle + flat-dir adapter), manifest parser, frontmatter `subscribe:` parser, registrar that fans members into the existing command / subagent / tool registries, dispatcher for triggered runs
- `source/events/` - Event router, file watcher source (chokidar), cron source (croner), backpressure (per-subscription concurrency cap + 500ms trailing debounce on `file.changed`)
- `source/daemon/` - Per-project daemon process: lockfile, Unix-socket IPC server / TUI client, CLI surface (`nanocoder daemon <start|stop|status|logs|install|uninstall>`), launchd plist + systemd user unit installers, background CI watch
- `source/acp/` - Agent Client Protocol server (`nanocoder --acp`) used by editors such as Zed and the VS Code extension: sessions, permissions, timeline, tool-call mapping
- `source/vscode/` - Legacy VS Code companion: WebSocket server for `--vscode`, discovery file, CLI path discovery, bundled extension installer
- `source/plugins/` - In-process plugin host that loads `.nanocoder/plugins/*.mjs` in trusted folders
- `source/sdk/` - Type definitions for the plugin API (`tool.execute.before/after`, `session.compacting`, `tui.prompt.append`, `permission.asked`)
- `source/verify/` - `nanocoder verify` headless PR review and CI-gate helpers: trust levels, semgrep scan, secret redaction, report formatting
- `source/storage/` - `nanocoder storage` read-only inspector for sessions, artifacts and checkpoint data
- `source/memory/` - Semantic project memory: storage, recall into the `## Project Context` block, freshness checks
- `source/context/` - React contexts (prompt scrubbing / privacy)
- `source/init/` - `nanocoder init` and `/init`: project analysis, presets, AGENTS.md generation
- `source/cli-completions/` - `nanocoder completion <bash|zsh|fish>` script rendering
- `source/security/` - Cross-cutting security specs (command-injection tests); no runtime code
- `source/artifacts/` - Per-session plan, task and walkthrough artifacts stored in the app data dir
- `source/repo-map/` - Ranked repository symbol map used by `/repomap`
- `source/stats/` - Lifetime `/stats` recording, aggregation and charts

### State Management Pattern

All state lives in `source/hooks/useAppState.tsx`. Other hooks (`useChatHandler`, `useModeHandlers`) receive state and setters from it. `source/app/App.tsx` orchestrates them via `useAppHandlers`. Global `source/utils/message-queue.tsx` lets deep components push chat messages without prop-drilling. Non-UI modules import the `log*` helpers from `source/utils/message-queue-core.ts` instead, which has no React/Ink imports, so the CLI fast paths stay Ink-free (`source/config/no-ink-fast-paths.spec.ts` enforces this).

### Tool System

Tools are registered in `source/tools/tool-manager.ts` with:
- **handler**: Executes the tool
- **nativeTool**: AI SDK tool definition
- **formatter**: Formats output for display
- **validator**: Pre-execution validation (optional)

File editing uses a content-based approach:
- `string_replace`: Primary edit tool - replaces exact content
- `diff_edit`: Applies search/replace edits to a file
- `write_file`: Whole file overwrites

Two execution paths exist: native tool calling (preferred, via AI SDK) and an XML fallback for models that don't support tools. `LLMChatResponse.toolsDisabled` signals which path produced the response. The conversation loop runs `parseToolCalls()` (in `source/tool-calling/`) whenever the response has no native tool calls — always on the fallback path, and on the native path too, since models marketed as native-tool-capable sometimes regress to emitting tool-call text. Malformed text there feeds the self-correction retry loop capped by `nanocoder.retries.maxMalformedRetries`.

### Command System

Slash commands live in `source/commands/` and are lazy-loaded via `source/commands/lazy-registry.ts`. To add a new command: create the command file, then add an entry to `lazyCommands` in the registry. Every slash command is resolved by `dispatchSlashCommand` in `source/app/utils/command-dispatcher.ts`, in this order: custom commands, MCP prompts, old names from `source/commands/aliases.ts`, inline `?key=value` overrides, then the registry.

A command module exports one of two shapes (`source/types/commands.ts`):
- **`Command`** (`handler`): reads its args, the messages and some metadata, and returns a React element or string to show.
- **`StatefulCommand`** (`run`): changes app state. It receives a typed `CommandContext` (args plus the setters and services it may use) and returns a `CommandCompletion` saying when the prompt is handed back: `done`, `done-after-render` once queued output has rendered, `handed-off` when something it started (a chat turn, a picker) completes it, `{show}` to display output the way a `Command` does, or `{until}` with a promise that settles when a live component it mounted closes. If a command needs app state the context lacks, add it to `CommandContext` and to `createCommandContext` in the dispatcher.

Some older stateful commands (compact, context-max, the `create` subcommands) are still stubs whose logic lives in the handlers under `source/app/utils/handlers/`, run by the dispatcher before the registry. They are being moved to `StatefulCommand`; do not add new ones there.

A command that does slow work before returning (LLM round-trip, network) should declare `progressLabel`. The dispatcher then holds a `CommandProgress` spinner in the live slot for the duration, so the UI is not silent while the command runs. Set it on both the module's command object and its `lazyCommands` entry - the spinner has to render before `load()` resolves, so it cannot be read off the lazily-imported module.

### Custom Tools

File-based tools live in `source/custom-tools/`. `CustomToolLoader` discovers `.md` files in `.nanocoder/tools/` (project) and `~/.config/nanocoder/tools/` (personal, via `getConfigPath()`); project tools shadow personal ones by `name`. Each file's YAML frontmatter declares the schema; `schema-builder.ts` synthesizes both the AI SDK `inputSchema` and a `ToolValidator`. `template.ts` renders the script body with `{{ name }}` and `{{# section }}` placeholders, shell-quoting all substitutions of declared parameters; `findUnsafePlaceholder` rejects (at parse time and again in the handler) a body that puts a placeholder where that quoting doesn't hold (inside quotes, comments, here-docs). `handler.ts` spawns the shell with timeout + env/cwd resolution. `build-tool.ts` glues everything into a `ToolEntry`, then `ToolManager.initializeCustomTools()` registers them into the same registry as built-ins and MCP tools - downstream code (`/tools`, subagents, mode filtering) sees them through the unified registry. Mode policy for custom tools lives in `ToolManager.getAvailableToolNames`: plan mode requires `approval=never && read_only=true`, headless mode requires `approval=never`.

### Configuration Resolution Order

1. `agents.config.json` in working directory (project-level)
2. Platform config dir: `~/.config/nanocoder/agents.config.json` (Linux), `~/Library/Preferences/nanocoder/` (macOS)

Providers merge by name across both layers (plus `NANOCODER_PROVIDERS`); each `nanocoder.*` block is taken whole from the highest layer that defines it. If `NANOCODER_CONFIG_DIR` is set, it replaces the platform dir (the project layer still applies, except that `loadPreferences` skips a project `nanocoder-preferences.json`).

Environment variable substitution in config values: `$VAR`, `${VAR}`, `${VAR:-default}` (uppercase names only)

### LLM Client Architecture

`source/client-factory.ts` creates clients via `createLLMClient(provider?)`. Uses Vercel AI SDK (`ai` v6) with `@ai-sdk/openai-compatible` for any OpenAI-compatible API, plus dedicated `@ai-sdk/anthropic` and `@ai-sdk/google` providers. The wrapper logic (streaming, tool calls, error handling, prepareStep, retries) lives in `source/ai-sdk-client/`.

### Skills

A **skill** is the unit of extension. Two ergonomic forms over one primitive:

- **Single-file**: a `.md` in `.nanocoder/commands|agents|tools/`. Filename is the skill name. Optional `subscribe:` block in frontmatter declares event triggers. Backwards-compatible with the legacy flat dirs.
- **Bundle**: a directory under `.nanocoder/skills/<name>/` containing `skill.yaml` plus optional `commands/`, `agents/`, `tools/` subdirs. Multi-piece features (e.g. a `pr-reviewer` skill with a subagent + tool + command) live in a bundle.

`source/skills/bootstrap.ts` drives loading: the legacy per-kind loaders read single-file skills (wrapped by `source/skills/adapters.ts`), and `source/skills/bundle-loader.ts` reads bundles, from project / personal / built-in locations in priority order. The **registrar** (`source/skills/registrar.ts`) fans each skill's members into the existing `CustomCommandLoader`, `SubagentLoader`, and `ToolManager.registry` - downstream consumers (`/tools`, agent tool, mode filters) keep using their familiar registries.

Bundle tools default to `tools_visibility: scoped`: hidden from the global tool list, visible only to the bundle's own subagent. Single-file tools default to `global`.

**Event triggers**: subscriptions on a member's frontmatter or a manifest's `subscribe:` block. The **per-project daemon** (`source/daemon/`, started by `nanocoder daemon start`) owns file-watch and cron sources. The interactive TUI never starts event sources. `confirm: true` on a subscription dispatches the triggered run in `plan` mode instead of `headless`.

## Code Style

- **TypeScript strict mode** with `@/*` path alias mapping to `source/*`
- **Biome** for formatting (tabs, single quotes, semicolons, trailing commas)
- **Key lint rules**: `useExhaustiveDependencies: error`, `noUnusedVariables: error`, `noUnusedImports: error`
- **React 19** with Ink.js for CLI rendering

## Testing

- **Framework**: AVA with tsx loader
- **Location**: `source/**/*.spec.ts` files alongside source
- **Serial execution**: Tests run one at a time
- **Run single test**: `pnpm run test:ava source/path/to/file.spec.ts`

## Voice Plugin

The optional local voice plugin lives in `plugins/voice/`. The root build compiles it before compiling the main app and copies its runtime files into `dist/voice/`; type checks use the committed declaration shim at `source/types/nanocoder-voice.d.ts`. Run `pnpm run test:types:voice` when changing the plugin.

Cloud STT sends microphone audio to the configured OpenAI endpoint only after explicitly selecting `/voice stt cloud`; local STT is the default. Hands-free mode is unavailable in yolo mode.

## Development Modes

Five user-facing modes (Shift+Tab cycles them in this order during chat):
- **normal**: Confirm each tool before execution
- **auto-accept**: Automatically execute most tools (bash, destructive git, and MCP tools that are neither read-only nor `alwaysAllow`-ed still prompt)
- **yolo**: Automatically execute every tool without exception
- **plan**: Show tool calls but don't execute
- **architect**: Like auto-accept for file edits, then review the whole turn's result with a one-keypress checkpoint undo

There is also an internal **headless** mode used by the daemon for every triggered skill run (file.changed, schedule.cron, future kinds). Same posture as the legacy `scheduler` mode it supersedes: no `ask_user`, no foreground confirmations. Per-subscription `confirm: true` opts into `plan` mode instead.

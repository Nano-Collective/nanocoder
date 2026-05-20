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
pnpm run test:knip                              # Unused code detection
pnpm run test:benchmark                         # Run model benchmarks

# VS Code extension
pnpm run build:vscode   # Build extension to assets/nanocoder-vscode.vsix
```

## Project Overview

Nanocoder is a React-based CLI coding agent built with Ink.js that provides local-first AI assistance with multiple provider support (Ollama, OpenRouter, any OpenAI-compatible API).

**Entry point**: `source/cli.tsx` → dynamic import of `App` from `source/app/App.tsx` (re-exported via `source/app/index.ts`). `cli.tsx` has fast paths for `--help`/`--version` (no app import), copilot/codex device-flow login, and a `--plain` non-Ink shell (`source/plain/shell.ts`) for CI / non-TTY environments.

## Architecture

### Core Application Flow

1. **Directory Trust Check** (`useDirectoryTrust`) - First-run security disclaimer for new directories
2. **App Initialization** (`useAppInitialization`) - Creates LLM client, loads MCP servers, loads custom commands
3. **Central State** (`useAppState`) - Single source of truth for 50+ state variables
4. **Chat/Tool Flow** - User input → LLM → tool confirmation → execution → response

### Key Directories

- `source/hooks/` - React hooks: `useAppState` (central state), `useToolHandler`, `useModeHandlers`, `useAppHandlers` (orchestrator), plus `chat-handler/useChatHandler` (LLM interaction, in subdir)
- `source/app/` - `App.tsx` plus app-internal helpers (`utils/app-util.ts`, `utils/conversation-state.ts`, prompt sections, orchestration hooks in `app/hooks/`)
- `source/ai-sdk-client/` - Wrapper over Vercel AI SDK: chat handler, providers, converters, tool helpers, error handling
- `source/tools/` - Built-in tools (file ops, bash, search, web fetch). Registered in `source/tools/tool-manager.ts`; main file editors are `string_replace` and `write_file`
- `source/components/` - Ink UI components
- `source/config/` - Configuration loading and preferences
- `source/commands/` - Built-in slash commands (`/model`, `/provider`, `/clear`, etc.)
- `source/custom-commands/` - User-defined markdown commands from `.nanocoder/commands/`
- `source/mcp/` - Model Context Protocol server integration
- `source/tool-calling/` - XML/text tool-call parsers for the fallback path (non-native-tool models)
- `source/services/` - Checkpoint manager, bash executor, file snapshots
- `source/session/` - Chat session persistence (autosave / resume)
- `source/schedule/` - Cron-based scheduled agent runs (`scheduler` mode)
- `source/subagents/` - Subagent executor (delegated agent runs)
- `source/auth/` - Copilot / Codex device-flow login
- `source/lsp/` - Language server client integration
- `source/wizards/` - Interactive setup flows (config, MCP, providers)
- `source/plain/` - Non-Ink CLI shell used by `--plain`

### State Management Pattern

All state lives in `source/hooks/useAppState.tsx`. Other hooks (`useChatHandler`, `useToolHandler`, `useModeHandlers`) receive state and setters from it. `source/app/App.tsx` orchestrates them via `useAppHandlers`. Global `source/utils/message-queue.tsx` lets deep components push chat messages without prop-drilling.

### Tool System

Tools are registered in `source/tools/tool-manager.ts` with:
- **handler**: Executes the tool
- **nativeTool**: AI SDK tool definition
- **formatter**: Formats output for display
- **validator**: Pre-execution validation (optional)

File editing uses a content-based approach:
- `string_replace`: Primary edit tool — replaces exact content
- `write_file`: Whole file overwrites

Two execution paths exist: native tool calling (preferred, via AI SDK) and an XML fallback for models that don't support tools. `LLMChatResponse.toolsDisabled` signals which path produced the response; the conversation loop only runs `parseToolCalls()` (in `source/tool-calling/`) when `toolsDisabled` is true.

### Command System

Slash commands live in `source/commands/` and are lazy-loaded via `source/commands/lazy-registry.ts`. To add a new command: create the command file exporting a `Command` object (name, description, handler), then add an entry to `lazyCommands` in the registry. Commands return React elements for Ink rendering. Some commands (clear, model, provider, etc.) need app state and are intercepted as "special commands" in `source/app/utils/app-util.ts`.

### Custom Tools

File-based tools live in `source/custom-tools/`. `CustomToolLoader` discovers `.md` files in `.nanocoder/tools/` (project) and `~/.config/nanocoder/tools/` (personal, via `getConfigPath()`); project tools shadow personal ones by `name`. Each file's YAML frontmatter declares the schema; `schema-builder.ts` synthesizes both the AI SDK `inputSchema` and a `ToolValidator`. `template.ts` renders the script body with `{{ name }}` and `{{# section }}` placeholders, shell-quoting all substitutions. `handler.ts` spawns the shell with timeout + env/cwd resolution. `build-tool.ts` glues everything into a `ToolEntry`, then `ToolManager.initializeCustomTools()` registers them into the same registry as built-ins and MCP tools — downstream code (`/tools`, subagents, mode filtering) sees them through the unified registry. Mode policy for custom tools lives in `ToolManager.getAvailableToolNames`: plan mode requires `approval=never && read_only=true`, scheduler mode requires `approval=never`.

### Configuration Resolution Order

1. `agents.config.json` in working directory (project-level)
2. Platform config dir: `~/.config/nanocoder/agents.config.json` (Linux), `~/Library/Preferences/nanocoder/` (macOS)
3. `~/.agents.config.json` (legacy fallback)

If `NANOCODER_CONFIG_DIR` is set, the platform/legacy lookups are skipped and that directory is used directly.

Environment variable substitution in config values: `$VAR`, `${VAR}`, `${VAR:-default}`

### LLM Client Architecture

`source/client-factory.ts` creates clients via `createLLMClient(provider?)`. Uses Vercel AI SDK (`ai` v6) with `@ai-sdk/openai-compatible` for any OpenAI-compatible API, plus dedicated `@ai-sdk/anthropic` and `@ai-sdk/google` providers. The wrapper logic (streaming, tool calls, error handling, prepareStep, retries) lives in `source/ai-sdk-client/`.

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

## Development Modes

Four user-facing modes (toggle with Shift+Tab during chat):
- **normal**: Confirm each tool before execution
- **auto-accept**: Automatically execute most tools (bash and destructive git still prompt)
- **yolo**: Automatically execute every tool without exception
- **plan**: Show tool calls but don't execute

There is also an internal **scheduler** mode used by `source/schedule/` for cron-driven runs; it disables interactive tools (`ask_user`, `agent`).

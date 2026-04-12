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
pnpm run test:all       # Full suite: format, lint, types, AVA tests, knip

# Individual test commands
pnpm run test:ava source/path/to/file.spec.ts  # Run single test file
pnpm run test:ava:coverage                      # Tests with coverage
pnpm run test:types                             # TypeScript checking only
pnpm run test:lint:fix                          # Auto-fix lint/format issues

# VS Code extension
pnpm run build:vscode   # Build extension to assets/nanocoder-vscode.vsix
```

## Project Overview

Nanocoder is a React-based CLI coding agent built with Ink.js that provides local-first AI assistance with multiple provider support (Ollama, OpenRouter, any OpenAI-compatible API).

**Entry point**: `source/cli.tsx` → Ink render of `App` from `source/app.tsx`

## Architecture

### Core Application Flow

1. **Directory Trust Check** (`useDirectoryTrust`) - First-run security disclaimer for new directories
2. **App Initialization** (`useAppInitialization`) - Creates LLM client, loads MCP servers, loads custom commands
3. **Central State** (`useAppState`) - Single source of truth for 50+ state variables
4. **Chat/Tool Flow** - User input → LLM → tool confirmation → execution → response

### Key Directories

- `source/hooks/` - React hooks: `useAppState` (central state), `useChatHandler` (LLM interaction), `useToolHandler` (tool confirmation/execution)
- `source/tools/` - Built-in tools: file ops, bash, search, web fetch
- `source/components/` - Ink UI components
- `source/config/` - Configuration loading and preferences
- `source/commands/` - Built-in slash commands (`/model`, `/provider`, `/clear`, etc.)
- `source/custom-commands/` - User-defined markdown commands from `.nanocoder/commands/`
- `source/mcp/` - Model Context Protocol server integration
- `source/tool-calling/` - Tool call parsers (XML fallback for non-tool-calling models)

### State Management Pattern

All state lives in `useAppState.tsx`. Other hooks (`useChatHandler`, `useToolHandler`, `useModeHandlers`) receive state and setters from it. `App.tsx` orchestrates these hooks together. Global `message-queue.ts` allows deep components to add chat messages.

### Tool System

Tools are registered in `tool-manager.ts` with:
- **handler**: Executes the tool
- **nativeTool**: AI SDK tool definition
- **formatter**: Formats output for display
- **validator**: Pre-execution validation (optional)

File editing uses content-based approach:
- `string_replace`: Primary edit tool - replaces exact content
- `write_file`: Whole file overwrites

### Command System

Slash commands live in `source/commands/` and are lazy-loaded via `source/commands/lazy-registry.ts`. To add a new command: create the command file exporting a `Command` object (name, description, handler), then add an entry to `lazyCommands` in the registry. Commands return React elements for Ink rendering. Some commands (clear, model, provider, etc.) need app state and are intercepted as "special commands" in `source/app/utils/app-util.ts`.

### Configuration Resolution Order

1. `agents.config.json` in working directory (project-level)
2. Platform config dir: `~/.config/nanocoder/agents.config.json` (Linux), `~/Library/Preferences/nanocoder/` (macOS)
3. `~/.agents.config.json` (legacy fallback)

Environment variable substitution: `$VAR`, `${VAR}`, `${VAR:-default}`

### LLM Client Architecture

`client-factory.ts` creates clients via `createLLMClient(provider?)`. Uses Vercel AI SDK with `createOpenAICompatible` for any OpenAI-compatible API. Supports streaming responses and tool calling.

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

Four modes (toggle with Shift+Tab during chat):
- **normal**: Confirm each tool before execution
- **auto-accept**: Automatically execute most tools (bash and destructive git still prompt)
- **yolo**: Automatically execute every tool without exception
- **plan**: Show tool calls but don't execute

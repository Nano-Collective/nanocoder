# AGENTS.md

Instructions for AI coding agents working on **@nanocollective/nanocoder**. `CLAUDE.md` has the full architecture map; this file is the short version.

## Project Overview

Nanocoder is a local-first CLI coding agent written in TypeScript. The terminal UI is React 19 rendered with Ink. It talks to many LLM providers (Ollama, OpenRouter, Anthropic, Gemini and any OpenAI-compatible API) through the Vercel AI SDK. It is not a web application.

- **Package**: `@nanocollective/nanocoder`, binary `nanocoder` (`dist/cli.js`)
- **Node**: 22.12 or newer (`engines` in `package.json`)
- **Package manager**: pnpm, pinned by the `packageManager` field (use Corepack)

## Development Commands

```bash
pnpm install
pnpm run build          # Compile TypeScript to dist/ (also builds plugins/voice)
pnpm run start          # Run the compiled CLI
pnpm run dev            # tsc --watch (compile only; run `pnpm run start` separately)

pnpm run test:ava source/path/to/file.spec.ts   # Run one spec file
pnpm run test:types     # TypeScript check
pnpm run test:format    # Biome format check
pnpm run test:lint      # Biome lint check
pnpm run test:lint:fix  # Auto-fix lint and format issues
pnpm run test:knip      # Unused code detection
pnpm run test:all       # Format, types, lint, AVA, knip, audit, semgrep (slow)

pnpm run build:vscode   # Package the VS Code extension to assets/nanocoder-vscode.vsix
```

Prefer running the focused spec files for the code you changed over `test:all`.

## Entry Points

- `source/cli.tsx` - CLI entry. Parses arguments, handles fast-path subcommands (`storage`, `daemon`, `verify`, `skills`, `config`, `trust`, `init`, `completion`, `--help`, `--version`) without loading Ink, then starts the ACP server, the plain shell or the TUI.
- `source/cli-args.ts` - Top-level command list and argument validation.
- `source/app/load-tui-renderer.ts` and `source/app/render-tui.tsx` - Load and render the Ink app.
- `source/app/App.tsx` - Root Ink component.
- `source/plain/shell.ts` - Non-Ink runtime for `--plain`, CI and non-TTY runs.
- `source/acp/acp-server.ts` - Agent Client Protocol server for `nanocoder --acp`.

## Key Directories

- `source/hooks/` - App state (`useAppState.tsx`), mode handling, orchestration (`useAppHandlers.tsx`) and the chat loop (`chat-handler/`)
- `source/ai-sdk-client/` - Wrapper over the Vercel AI SDK: streaming, tool calls, providers, error handling
- `source/tools/` - Built-in tools, registered in `source/tools/tool-manager.ts`; file editors live in `source/tools/file-ops/`
- `source/tool-calling/` - XML/text tool-call parsers for models without native tool calling
- `source/commands/` - Built-in slash commands, lazy-loaded via `source/commands/lazy-registry.ts`
- `source/config/` - Config loading (`agents.config.json`, `.mcp.json`), preferences, paths, directory trust
- `source/mcp/` - MCP client integration
- `source/skills/`, `source/custom-commands/`, `source/custom-tools/`, `source/subagents/` - User extensions loaded from `.nanocoder/`
- `source/plugins/` and `source/sdk/` - In-process plugin host and plugin API types
- `source/daemon/` and `source/events/` - Per-project daemon and its file-watch and cron event sources
- `source/services/` - Checkpoints, bash execution, lifecycle hooks, formatters, auto-commit
- `source/components/` - Shared Ink UI components
- `plugins/vscode/` - VS Code extension; `plugins/voice/` - optional voice plugin
- `docs/` - User documentation

## Code Style

- TypeScript strict mode, with the `@/*` alias mapping to `source/*`
- Biome formatting: tabs, single quotes, semicolons, trailing commas
- Lint rules that fail the build: `useExhaustiveDependencies`, `noUnusedVariables`, `noUnusedImports`
- Function components and hooks for UI; no web DOM APIs (this renders to a terminal)

## Testing

- AVA with the tsx loader; specs sit next to the code as `*.spec.ts` / `*.spec.tsx`
- Tests run serially
- Add or update a spec alongside every behaviour change

## Changesets

User-facing changes need a changeset in `.changeset/`. The package name in its frontmatter must be `"@nanocollective/nanocoder"`; a bare `nanocoder` passes PR checks but breaks the release. Docs-only changes do not need one.

```md
---
"@nanocollective/nanocoder": patch
---

One or two sentences describing the change for users.
```

## Repository

https://github.com/Nano-Collective/nanocoder

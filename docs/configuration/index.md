---
title: "Configuration"
description: "Configure Nanocoder providers, preferences, and settings"
sidebar_order: 5
---

# Configuration

Nanocoder is configured through JSON files that control AI providers, MCP servers, user preferences, and more.

## JSON Schema (editors)

A JSON Schema for `agents.config.json` is published as `schemas/agents.config.schema.json`. It is generated deterministically from the on-disk config shape (see `scripts/generate-config-schema.ts`) and validated in CI to prevent drift.

To enable autocompletion and inline validation, add the `$schema` key at the top of your config:

```json
{
  "$schema": "https://raw.githubusercontent.com/Nano-Collective/nanocoder/main/schemas/agents.config.schema.json"
}
```

The schema only describes keys the loader actually reads from `agents.config.json`. Settings read from `nanocoder-preferences.json` (`notifications`, `sessions`, `paste`) are deliberately not advertised on this schema, and neither are MCP servers, which live in `.mcp.json` (see [MCP Configuration](mcp-configuration.md)).

You can also wire it up without the `$schema` key:

- **VS Code**: add a `jsonValidation` rule for `**/agents.config.json` pointing at the schema file.
- **JetBrains IDEs**: under *Settings → Languages & Frameworks → Schemas and DTDs → JSON Schema Mappings*, add a mapping for `agents.config.json` to the schema file.
- **CLI validation** (any editor): `ajv validate -s schemas/agents.config.schema.json -d <your config>`.

## Configuration File Locations

Nanocoder reads `agents.config.json` from two layers:

1. **Project-level** (highest priority): `agents.config.json` in your current working directory
   - Use this for project-specific providers, models, or API keys
   - Perfect for team sharing or repository-specific configurations

2. **User-level**: Platform-specific configuration directory
   - **macOS**: `~/Library/Preferences/nanocoder/agents.config.json`
   - **Linux/Unix**: `~/.config/nanocoder/agents.config.json` (respects `XDG_CONFIG_HOME`)
   - **Windows**: `%APPDATA%\nanocoder\agents.config.json`
   - Your global default configuration

How the layers combine depends on the setting:

- **Providers** are merged by name. Providers from the global file, the project file and the `NANOCODER_PROVIDERS` environment variable are all loaded; when two layers define a provider with the same name (case-insensitive), the higher-priority layer's entry replaces it (environment variable, then project, then global).
- **Every `nanocoder.*` block** (`autoCompact`, `hooks`, `retries`, `modeProviders` and so on) is resolved block by block: the project file's block wins as a whole if it exists, otherwise the global file's block is used. See the note under [Inspecting the Effective Configuration](#inspecting-the-effective-configuration).
  A top-level `providers` array outside the `nanocoder` key is still accepted as a legacy form. It is used only when the file has no `nanocoder.providers` array.
- **MCP servers** are not read from `agents.config.json` at all. They come from `.mcp.json` files and `NANOCODER_MCPSERVERS`; see [MCP Configuration](mcp-configuration.md).

> **Note:** `NANOCODER_CONFIG_DIR` replaces the platform-specific user-level directory above. It does not turn off the project layer for `agents.config.json` or `.mcp.json`: a project file in the working directory still applies. It does skip the project-level `nanocoder-preferences.json` for top-level preferences (see [Preferences](preferences.md) for the exceptions).

If no user-level `agents.config.json` or `nanocoder-preferences.json` exists yet, Nanocoder creates an empty (`{}`) one in the user-level directory the first time it resolves that file.

> **Tip:** Use `/setup-config` to list all available configuration files and open any of them in your `$EDITOR`.

## Inspecting the Effective Configuration

When a setting is not behaving the way you expect, the hard question is not
what the value is but which file set it. `nanocoder config` answers both
without booting the interactive app.

```bash
nanocoder config list                                   # every resolved key and its layer
nanocoder config show nanocoder.autoCompact.threshold   # one key, in detail
nanocoder config show autoCompact                       # a whole block
nanocoder config diff                                   # only what your files change
nanocoder config diff --json                            # machine-readable output
```

`config list` prints the layers in play — built-in defaults, the global config
directory, the project directory, and `NANOCODER_*` environment variables —
along with whether each file is present, missing, or unreadable. A `*` beside a
key means a lower-precedence layer also sets it.

`config show <key>` adds the built-in default, the values that lost, and a line
explaining the rule that decided the winner. The key can be given in full
(`nanocoder.autoCompact.threshold`), without the `nanocoder.` prefix
(`autoCompact.threshold`), or as a block name to print every field under it.

`config diff` is the debugging view: everything your config files change
relative to the defaults, followed by every value that is set somewhere but is
not in effect, with the reason it lost.

> **Note:** Most settings are resolved **block by block**, not key by key. The
> highest-precedence file that defines a block — say `nanocoder.autoCompact` —
> supplies the whole block, and the fields it omits fall back to built-in
> defaults rather than to a lower-precedence file. A project file setting one
> field therefore discards the global file's other fields for that block.
> `config diff` lists exactly those discarded values.

API keys and other credentials are replaced with `<redacted>` in every output
format. An unsubstituted `${VAR}` reference is shown verbatim, since naming the
variable is the point of the output and the reference is not itself a secret.

## Environment Variables

Keep API keys out of version control using environment variables. Variables are loaded from shell environment (`.bashrc`, `.zshrc`) or `.env` file in your working directory.

### General

| Variable | Description |
|----------|-------------|
| `NANOCODER_CONFIG_DIR` | Override the user-level configuration directory. Project-level `agents.config.json` and `.mcp.json` still apply; the project-level `nanocoder-preferences.json` is skipped for top-level preferences |
| `NANOCODER_CONTEXT_LIMIT` | Default context limit (tokens) used when no session override or provider `contextWindow`/`contextWindows` applies. It is checked before models.dev metadata (see [Context Limit Resolution Order](#context-limit-resolution-order)). Enables auto-compact and `/usage` to work correctly. The `--context-max` CLI flag takes priority |
| `NANOCODER_DATA_DIR` | Override the application data directory for internal data like usage statistics |
| `NANOCODER_INSTALL_METHOD` | Override installation detection (`npm`, `homebrew`, `nix`, `unknown`) |
| `NANOCODER_DEFAULT_SHUTDOWN_TIMEOUT` | Graceful shutdown timeout in milliseconds (default: 5000) |
| `NANOCODER_MAX_TURNS` | Maximum LLM turns for headless runs (`--plain` and ACP). Overrides `nanocoder.headless.maxTurns`; default 200. See [Headless](#headless) |
| `NANOCODER_TRUST_DIRECTORY` | Set to `1` to trust the working directory for a `--plain` run or `nanocoder daemon start`, and save it to `trustedDirectories` for later runs. See [Getting Started](../getting-started/index.md) |
| `NANOCODER_SKILLS_INDEX` | URL or local path of the skills index used by `nanocoder skills add` (same as `--index`). See [Skills](../features/skills.md) |
| `NANOCODER_DOCTOR_PROBE` | Set to `0` to stop `/doctor` from probing local provider ports |

### Provider & MCP Overrides

Add or override provider and MCP server configurations via environment variables. Entries are merged by name with the config files: an entry here replaces the file entry with the same name, and every other file entry stays in place.

| Variable | Description |
|----------|-------------|
| `NANOCODER_PROVIDERS` | JSON string of provider configurations (replaces same-named providers from config files) |
| `NANOCODER_PROVIDERS_FILE` | Path to a JSON file containing provider configurations (used if `NANOCODER_PROVIDERS` is not set) |
| `NANOCODER_MCPSERVERS` | JSON string of MCP server configurations (replaces same-named servers from `.mcp.json` files) |
| `NANOCODER_MCPSERVERS_FILE` | Path to a JSON file containing MCP server configurations (used if `NANOCODER_MCPSERVERS` is not set) |

See [Providers](providers/index.md) and [MCP Configuration](mcp-configuration.md) for format details and examples.

### Logging

These are covered in detail on the [Logging](logging.md) page.

| Variable | Description |
|----------|-------------|
| `NANOCODER_LOG_LEVEL` | Log level: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent` |
| `NANOCODER_LOG_DISABLE_FILE` | Disable file logging (`true` to disable; overrides `NANOCODER_LOG_LEVEL`) |
| `NANOCODER_LOG_DIR` | Override log directory |

### Environment Variable Substitution

You can reference environment variables in your configuration files using substitution syntax:

**Syntax:** `$VAR_NAME`, `${VAR_NAME}`, or `${VAR_NAME:-default}`

Substitution is applied recursively to all string fields in provider and MCP server configurations — any string value can reference environment variables, not just specific fields.

Variable names must be uppercase (letters, digits and underscores, not starting with a digit). A lowercase reference such as `$myVar` or `${api_key}` is not substituted and is left in the value as literal text.

See `.env.example` for setup instructions.

## Context Limit Resolution Order

Nanocoder resolves a model's context limit in this order:

1. Session override from `/context-max` or `--context-max`
2. Provider `contextWindows[model]` in `agents.config.json`
3. Provider `contextWindow` in `agents.config.json`
4. `NANOCODER_CONTEXT_LIMIT`
5. models.dev metadata
6. Built-in Ollama fallback map

This lets you persist context limits for unknown or local models without reapplying `/context-max` every session.

## Application Settings

Beyond providers and MCP servers, `agents.config.json` supports application-level settings under the `nanocoder` key.

### Auto-Compact

Automatically compress context when it reaches a percentage of the model's context limit. See [Context Compression](../features/context-compression.md) for full details on how compression works.

```json
{
  "nanocoder": {
    "autoCompact": {
      "enabled": true,
      "threshold": 60,
      "strategy": "llm",
      "mode": "conservative",
      "notifyUser": true
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable automatic compression |
| `threshold` | number | `60` | Context usage percentage to trigger compression (50–95) |
| `strategy` | string | `"llm"` | Compaction strategy: `"llm"` (model writes a structured summary) or `"mechanical"` (regex truncation) |
| `mode` | string | `"conservative"` | Mechanical compression mode: `"default"`, `"conservative"`, `"aggressive"` (ignored when strategy is `"llm"`) |
| `notifyUser` | boolean | `true` | Show a notification when auto-compact runs |

You can also override these per-session with `/compact --auto-on`, `/compact --auto-off`, `/compact --threshold <n>`, and `/compact --strategy llm|mechanical`.

### Sessions

Configure automatic session saving and retention. See [Session Management](../features/session-management.md) for usage details.

This setting is stored in `nanocoder-preferences.json` (see [Preferences](preferences.md) for file locations) — not in `agents.config.json`.

```json
{
  "nanocoder": {
    "sessions": {
      "autoSave": true,
      "saveInterval": 30000,
      "maxSessions": 100,
      "maxMessages": 1000,
      "retentionDays": 30,
      "directory": ""
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `autoSave` | boolean | `true` | Enable/disable automatic session saving |
| `saveInterval` | number | `30000` | Milliseconds between saves (minimum 1000) |
| `maxSessions` | number | `100` | Maximum sessions to keep (minimum 1) |
| `maxMessages` | number | `1000` | Maximum messages sent to the model in interactive/headless chat and by [subagents](../features/subagents.md) (minimum 1). Preserves on-disk history and system messages, capping only the context window. |
| `retentionDays` | number | `30` | Auto-delete sessions older than this (minimum 1) |
| `directory` | string | (platform default) | Custom storage directory for session files |
| `smartTitles` | boolean | `true` | Generate a short title once per session (ACP clients only). See [Session Management](../features/session-management.md) |
| `titleModel` | string | (session model) | Model used for title generation |
| `titleProvider` | string | (session provider) | Provider used for title generation |

### Headless

Limits for non-interactive runs — the `--plain` shell (used in CI and non-TTY environments) and the ACP loop. There is no human to stop a wedged model in these runs, so the conversation loop caps the number of LLM turns.

When the cap is reached, the loop does **not** error out and discard work. On the final turn it strips all tools and asks the model to produce its answer using only the information it already has, so the run ends with a usable result.

```json
{
  "nanocoder": {
    "headless": {
      "maxTurns": 200
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxTurns` | number | `200` | Maximum LLM turns before the loop forces a final, tool-free answer (minimum 1). Raise it for long iterative jobs; the `NANOCODER_MAX_TURNS` env var takes precedence over this setting. |

One turn is a single LLM response plus its batch of tool executions. The default of 200 is high enough for long iterative jobs to finish while still bounding cost and wall-clock time for an unattended run that gets stuck.

### OS sandbox

File tools already refuse paths outside the project. `execute_bash` and `!command` did not: they spawn `sh` with your full user privileges. Set `nanocoder.sandbox` to `true` (boolean; a string like `"true"` is ignored and treated as off, with a warning) to wrap those two in an OS jail. Default is off.

```json
{
  "nanocoder": {
    "sandbox": true
  }
}
```

When on:

- **macOS** — `sandbox-exec` (deprecated by Apple, still present): no network; writes allowed in the project root, a per-command temp dir (`TMPDIR`), the Darwin user temp dir (bare `mktemp` ignores `TMPDIR`), and `/tmp` / `/private/tmp`. Reads are not restricted (`allow default`), so `cat ~/.ssh/id_rsa` still works and stdout still reaches the model.
- **Linux** — `bwrap` from `PATH` (bubblewrap): no network; `--ro-bind / /` plus a writable bind of the project and a per-command temp dir, plus `--tmpfs /tmp`. Same read caveat as macOS. If `bwrap` is missing, or present but cannot create a user namespace (`--unshare-net`), the tool returns an error and does **not** fall through to unsandboxed bash.
- **Windows** — not supported in this version. The tool returns an error if the flag is on.

This is not a secrets boundary. Network is blocked, writes outside the project and the jail temp dir are blocked, but the command can still read the rest of the filesystem and print it into the conversation.

Timeouts and cancel are unchanged. This does not sandbox custom tools or MCP.

### Retry Limits

Caps on how many times the conversation loop auto-retries a failing pattern without user intervention, so a stuck model cannot silently drain tokens. They apply in both runtimes: the interactive TUI loop and the `--plain` runtime used by `nanocoder run "..."` in CI and non-TTY environments (where they act within the [Headless](#headless) `maxTurns` ceiling). These are agent-loop limits — the per-provider `maxRetries` setting is unrelated and governs network request retries (see [Providers](providers/index.md)).

```json
{
  "nanocoder": {
    "retries": {
      "maxRepeatedToolCalls": 3,
      "maxEmptyTurns": 2,
      "maxMalformedRetries": 2,
      "maxTruncatedTurns": 2
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRepeatedToolCalls` | number | `3` | Pause threshold for consecutive identical tool calls (minimum 2). The check fires when the same call (or set of calls) is emitted for the Nth consecutive turn, before that call runs - so the default of 3 executes the repeated call twice and pauses on the third emission. In an interactive session you are asked whether to continue - useful when the repetition is legitimate, such as polling a long-running job - or stop. `--plain` and other non-interactive runs stop with a clear error. Calls to unknown tools count toward the streak too, so a model stuck on a nonexistent tool hits the same cap. |
| `maxEmptyTurns` | number | `2` | Consecutive empty assistant turns that are auto-nudged before giving up (minimum 0). The interactive loop additionally compacts the context and retries once before stopping; the `--plain` runtime stops directly after the nudges. |
| `maxMalformedRetries` | number | `2` | Malformed self-correction retries allowed for text-parsed tool calls before the loop gives up (minimum 0). Applies to the XML fallback path in both runtimes. The interactive loop also parses tool-call text from native-tool models that emit it instead of native calls, so the cap covers that case there; the `--plain` runtime only parses text on the XML fallback path. |
| `maxTruncatedTurns` | number | `2` | Consecutive turns cut off at the provider's output-token limit that are asked to continue before the loop accepts what it has (minimum 0). `--plain` runtime only. A truncated turn carries no tool calls, so without this the loop reads the fragment as a finished answer - see the note below. |

Choosing "Continue" at the repeated-tool-call prompt runs the paused call and re-checks after `maxRepeatedToolCalls` further identical calls, so a genuinely stuck model is re-prompted rather than left looping.

`maxTruncatedTurns` covers a quieter failure. When a provider stops generating because the response hit its output-token limit, what comes back is a fragment - and a fragment with no tool calls is indistinguishable from a model that finished talking. The `--plain` loop used to accept it and exit `0`, which meant a run whose entire deliverable was a tool call (write this file, open this PR) could report success having produced nothing. It now asks the model to continue from where it was cut off, up to this many times, and only then returns what it has. Tasks that spend their whole output budget narrating before acting are the ones that hit it.

Setting `maxEmptyTurns` or `maxMalformedRetries` to `0` disables the nudge entirely, so the first empty or malformed turn ends the run - the fail-fast behaviour `--plain` had before these limits existed, worth setting when a silent or malformed-output model should cost one model call rather than three. The interactive loop still runs its single compact-and-retry after an empty turn even at `0`.

> **Warning - CI polling patterns:** in `--plain` runs (`nanocoder run "..."` in CI and non-TTY environments) there is no prompt to answer, so `maxRepeatedToolCalls` is a hard stop. A workflow whose model legitimately repeats the identical command - polling a deploy, re-running the same check while waiting on an external state change - aborts with exit code `1` once the cap is hit, by default on the third consecutive identical call. Raise `nanocoder.retries.maxRepeatedToolCalls` in that project's `agents.config.json` before relying on such a polling pattern.

Unlike [Headless](#headless), these limits do not cover the ACP loop (`--acp`, used by editor clients), which is bounded by `maxTurns` alone. Delegated [subagent](../features/subagents.md) runs apply `maxRepeatedToolCalls` - a stuck subagent stops with an error naming the setting, since there is nobody to ask inside a delegated run - but not the others: a subagent's loop ends on its own after an empty turn, it does not use text-parsed tool calls, and `maxTruncatedTurns` is specific to the `--plain` loop.

### Paste Handling

Configure how pasted text is handled in the input. By default, single-line pastes of 800 characters or fewer are inserted directly, while longer pastes are collapsed into a `[Paste #N: X chars]` placeholder and multi-line pastes into a `[Paste #N: X lines]` placeholder.

You can change the threshold interactively via `/settings` → **Paste Threshold**, or by editing `nanocoder-preferences.json` directly:

```json
{
  "nanocoder": {
    "paste": {
      "singleLineThreshold": 800
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `singleLineThreshold` | number | `800` | Maximum characters for a single-line paste to be inserted directly. Pastes longer than this (or multi-line pastes) become placeholders. Must be a positive integer. |

This setting is stored in `nanocoder-preferences.json` (see [Preferences](preferences.md) for file locations).

### Default Development Mode

Set the initial development mode for all new interactive sessions. Without this setting, Nanocoder always starts in **normal** mode. Once a session begins, you can still switch modes at any time using `/mode`.

```json
{
  "nanocoder": {
    "defaultMode": "plan"
  }
}
```

| Value | Description |
|-------|-------------|
| `"normal"` | Standard mode - tools that change things prompt for approval; read-only tools run directly |
| `"auto-accept"` | Semi-automatic - read-only and safe tools auto-run; bash and tools marked as always needing approval still prompt |
| `"yolo"` | Fully automatic — no confirmations at all |
| `"plan"` | Read-only exploration mode — only read/search/list tools available |
| `"architect"` | Plan-then-build mode. See [Development Modes](../features/development-modes.md) |

The `--mode` CLI flag always takes precedence over this config value. Non-interactive runs (`nanocoder run ...`) always default to `auto-accept` regardless of this setting.

### Mode Providers

Use a different provider and model per development mode, for example a fast, cheap model for plan mode. When you switch into a mode listed here (or start in one), Nanocoder switches to its provider and model; switching into a mode that is not listed restores your normal provider and model.

```json
{
  "nanocoder": {
    "modeProviders": {
      "plan": {"provider": "OpenRouter", "model": "google/gemini-2.5-flash"},
      "yolo": {"provider": "Ollama", "model": "qwen3-coder:30b"}
    }
  }
}
```

Keys are mode names (`normal`, `auto-accept`, `yolo`, `plan`, `architect`). Each entry needs a `provider` that matches a configured provider name (case-insensitive) and a `model`; if that provider has a non-empty `models` list, the model must be in it. Invalid entries are skipped with an error in the log. A `--provider` or `--model` CLI flag takes priority at startup.

### Model Tuning

The `nanocoder.tune` block sets default tool profile, tool-calling mode and model parameters for every session. It is the same configuration `/tune` edits at runtime. See [Tune](../features/tune.md) for the fields and how this block layers with `/tune` preferences.

### Tool Auto-Approval

Allow specific tools to run without confirmation, even in normal development mode. The `alwaysAllow` array accepts tool names — listed tools execute immediately without prompting for approval, and the same list also applies to non-interactive runs (`nanocoder run ...`).

```json
{
  "nanocoder": {
    "alwaysAllow": ["execute_bash", "read_file", "find_files"]
  }
}
```

### Disabling Tools

Turn off individual tools globally with the top-level `disabledTools` array. Listed tools are filtered out everywhere the model could ask for them — chat, [subagents](../features/subagents.md), and every [`/tune` profile](../features/tune.md). The model is told they don't exist, so it won't try to call them.

```json
{
  "nanocoder": {
    "disabledTools": ["execute_bash", "web_search"]
  }
}
```

Names match the registered tool ids (`read_file`, `write_file`, `string_replace`, `execute_bash`, `web_search`, `fetch_url`, `agent`, etc.). [MCP](mcp-configuration.md) tools follow the same naming as in their server config.

`fetch_url` always refuses internal addresses, in every mode (including yolo and `alwaysAllow`): loopback, private ranges (RFC 1918, CGNAT, link-local and their IPv6 equivalents), `localhost` and `*.localhost`, and cloud metadata hosts such as `169.254.169.254` and `metadata.google.internal`. Every redirect hop is checked the same way.

Resolution: project-level `agents.config.json` wins over the global config. The list is layered on top of `/tune` profiles and mode exclusions — if `nano` profile would otherwise expose `read_file`, listing it in `disabledTools` removes it. Subagents respect the global list even if their own `tools` allow-list includes the disabled name.

### Lifecycle Hooks

Run your own shell commands at fixed points in the agent loop — before/after a tool, on session start/end, on prompt submit, before compaction. Hooks cost no tokens and fire every time, and a `pre-tool-use` hook that exits non-zero denies the tool call.

```json
{
  "nanocoder": {
    "hooks": {
      "post-tool-use": [
        {
          "matchTools": ["write_file", "string_replace"],
          "command": "biome check --write \"$NANOCODER_FILE\""
        }
      ],
      "pre-tool-use": [
        {"name": "no-env", "command": ".nanocoder/hooks/guard.sh", "timeout": 5000}
      ],
      "session-start": [{"command": "git log --oneline -5"}]
    }
  }
}
```

Each entry takes `command` (required), plus optional `matchTools` (tool names the hook applies to; omitted means all), `matchPaths` (file globs the hook applies to; see [Scoping by file](../features/hooks.md#scoping-by-file)), `timeout` (ms, default 30000, except `session-end` which defaults to 2000 to fit inside the shutdown budget), and `name` (label used in messages and `/doctor`). Context arrives as `NANOCODER_*` environment variables - `$VAR` references inside `command` are deliberately left unexpanded at load time so the shell sees them.

Hooks are project-local shell commands, so they carry the same code-execution weight as project MCP servers in `.mcp.json` and are gated by the same directory-trust prompt. See [Lifecycle Hooks](../features/hooks.md) for the full event list, environment contract, and blocking semantics.

### Custom System Prompt

Override or extend the built-in system prompt with your own. Useful when running small or context-constrained models where the default prompt consumes too many tokens, or when you want to specialize Nanocoder for a non-coding workflow.

The simplest form replaces the entire built-in prompt with inline content:

```json
{
  "nanocoder": {
    "systemPrompt": {
      "content": "You are an AI model running on CPU. Be concise."
    }
  }
}
```

Or load the prompt from a file (path is resolved relative to the working directory unless absolute):

```json
{
  "nanocoder": {
    "systemPrompt": {
      "mode": "replace",
      "file": "./.nanocoder/system-prompt.md"
    }
  }
}
```

Use `"mode": "append"` to keep the built-in prompt and add your text at the end:

```json
{
  "nanocoder": {
    "systemPrompt": {
      "mode": "append",
      "content": "Always respond in British English."
    }
  }
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `mode` | string | `"replace"` | `"replace"` overrides the built-in prompt entirely (no system info, no AGENTS.md). `"append"` adds your content after the built-in prompt. |
| `content` | string | — | Inline prompt text. Takes priority over `file` if both are set. |
| `file` | string | — | Path to a markdown/text file containing the prompt. Resolved relative to the working directory if not absolute. |

**Notes:**
- In `replace` mode, the built-in `## SYSTEM INFORMATION` section and AGENTS.md auto-append are skipped — include them yourself if you need them.
- Tool definitions are still injected into the prompt for providers that don't support native tool calling. Tool availability is controlled separately via `disabledTools` and `/tune`.
- If the file can't be read, Nanocoder logs a warning and falls back to the built-in prompt.
- Project-level `agents.config.json` wins over the global config.

### Web Search

The `web_search` tool uses the [Brave Search API](https://brave.com/search/api/) and requires an API key to enable. Without a key, the tool is not registered and won't be available to the model.

Brave's free tier includes 2,000 queries per month. [Get an API key here](https://brave.com/search/api/).

```json
{
  "nanocoder": {
    "nanocoderTools": {
      "webSearch": {
        "apiKey": "$BRAVE_SEARCH_API_KEY"
      }
    }
  }
}
```

The `apiKey` field supports environment variable substitution (`$VAR`, `${VAR}`, `${VAR:-default}`), so you can keep the actual key in your environment rather than in the config file.

## Ignoring Files

Nanocoder already respects your `.gitignore`, so `node_modules`, `dist` and friends stay out of the way. But some files are tracked in git and still not worth spending context on: lockfiles, generated fixtures, vendored bundles, big snapshot files.

Create a `.nanocoderignore` at your project root to exclude those too. It uses the same pattern syntax as `.gitignore`:

```
# Tracked, but not worth the tokens
package-lock.json
pnpm-lock.yaml
tests/__fixtures__/
docs/generated/
```

**What it affects:** the `list_directory`, `find_files` and `search_file_contents` tools, the `@` file autocomplete, and the interactive file explorer. Matching files stop showing up in listings and search results, which is what keeps them out of the model's context.

**What it does not affect:** `read_file` and `execute_bash`. If the model is given an exact path it can still read the file, and nothing stops a `cat` in a shell command.

> **Important:** `.nanocoderignore` is a context-hygiene tool, not a secrets boundary. Listing `.env` in it makes the file harder for the model to stumble across, but it does not prevent the file being read. Keep real secrets out of the workspace, or out of files the agent has any reason to open.

Patterns are applied after `.gitignore` and Nanocoder's built-in defaults, so a leading `!` can un-ignore something:

```
# Nanocoder ignores dist/ by default; opt back in for this project
!dist
```

Checkpoints deliberately skip `.nanocoderignore`. A file you hid from listings is still snapshotted, so restoring a checkpoint reverts it like anything else. See [Checkpointing](../features/checkpointing.md).

## Sections

- [Providers](providers/index.md) - AI provider setup and configuration
- [MCP Configuration](mcp-configuration.md) - Model Context Protocol server integration
- [Preferences](preferences.md) - User preferences and application data
- [Logging](logging.md) - Structured logging with Pino
- [Lifecycle Hooks](../features/hooks.md) - Shell commands run at fixed points in the agent loop

See also [Inspecting the Effective Configuration](#inspecting-the-effective-configuration) for debugging which layer supplied a value.

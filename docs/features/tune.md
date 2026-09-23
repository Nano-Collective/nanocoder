---
title: "Tune"
description: "Runtime model tuning for tool profiles, compaction, native tool calling, and model parameters"
sidebar_order: 11
---

# Tune

The `/tune` command opens a modal UI for adjusting runtime model behaviour. It lets you change tool profiles, compaction strategy, native tool calling, and model parameters — all without restarting your session.

Settings are persisted to `nanocoder-preferences.json` and restored on next launch.

## Opening Tune

Type `/tune` in the chat input. Use arrow keys to navigate, **Enter** to select, and **Esc** to cancel.

## Settings

### Enabled / Disabled

The top menu item toggles tune on or off. When disabled, all settings revert to defaults. When enabled, the full settings menu appears.

### Tool Profile

Controls which tools the AI has access to.

| Profile | Tools | Behaviour |
|---------|-------|-----------|
| **auto** (default) | Resolves to `full`, `minimal`, or `nano` from the active model id | Cloud/unknown models get `full`; models up to 15B parameters get a reduced profile automatically |
| **full** | All registered tools including MCP servers | No filtering applied |
| **minimal** | 8 core tools: `read_file`, `write_file`, `string_replace`, `execute_bash`, `find_files`, `search_file_contents`, `list_directory`, `agent` | Slim prompt and single-tool enforcement enabled automatically |
| **nano** | 5 core tools: `read_file`, `diff_edit`, `write_file`, `execute_bash`, `search_file_contents` | Ultra-slim prompt, single-tool enforcement, AGENTS.md omitted by default |

The **auto** profile is the default. It keeps the full tool surface for cloud models and model ids with no size hint, resolves models up to 15B parameters to `minimal`, and resolves models up to 4B parameters to `nano`. The status bar shows the resolved profile, for example `tune: minimal (auto)`.

> **What about tasks and walkthroughs?** `write_tasks` and `write_walkthrough` are part of the `full` profile only. Under `minimal` or `nano` the AI will not build a task list or record a completion walkthrough — that prompt and tool budget is spent on editing instead. `/tasks` still works for managing the list yourself. Plan mode is the exception: `write_plan` is added back on every profile so plan review works everywhere. See [Task Management](task-management.md) and [Development Modes](development-modes.md).

> **Why don't I see my MCP tools?** MCP tools are only exposed in the resolved `full` profile. If you connect an MCP server but the model cannot see its tools, open `/tune` and either switch the tool profile to **full** or use a larger/cloud model so `auto` resolves to `full`. `/mcp` still shows connected servers even when the current tool profile filters their tools out of the model prompt.

The **minimal** profile is designed for small models (1B-15B parameters) that struggle with large tool sets. It reduces the system prompt size and forces the model to call one tool at a time.

The **nano** profile is designed for the smallest models or low-end hardware running larger models locally. It is strictly more aggressive than `minimal`:

- Drops `find_files`, `list_directory`, and `agent` (subagent delegation).
- Drops the `CORE PRINCIPLES` and `CODING PRACTICES` prompt sections.
- Uses shortened `TASK APPROACH`, `FILE OPERATIONS`, `CONSTRAINTS` sections (≤4 lines each).
- Replaces the verbose `SYSTEM INFORMATION` block with a single-line `## SYSTEM` line.
- Omits `AGENTS.md` from the system prompt by default (override with the **Include AGENTS.md** toggle).

Together these reduce the system prompt from ~500–700 tokens (`minimal`) to roughly ~150–250 tokens (`nano`), leaving more of the context window for actual work.

### Include AGENTS.md

Toggles whether `AGENTS.md` from the project root is appended to the system prompt.

- Defaults **ON** for `full` and `minimal` profiles (preserves prior behaviour).
- Defaults **OFF** for the `nano` profile.
- Can be flipped explicitly per session, persisted via preferences, or pinned in `agents.config.json` via `tune.includeAgentsMd`.

Disabling this is useful on tiny models that get crowded out by long project guidelines.

### Aggressive Compact

When enabled, sets the auto-compact threshold to 40% and mode to `aggressive`. This compresses conversation history more frequently and aggressively — useful for models with small context windows.

### Native Tool Calling

Toggle native tool calling on or off. When disabled, tools are described in the system prompt and the model uses XML fallback for tool calls instead of the provider's native tool calling API. This can help with models that have unreliable native tool support.

### Model Parameters

Fine-tune the model's generation parameters:

| Parameter | Range | Description |
|-----------|-------|-------------|
| **Temperature** | 0.1 - 2.0 | Controls randomness. Lower = more focused, higher = more creative |
| **Top P** | 0 - 1.0 | Nucleus sampling. Lower = fewer token choices considered |
| **Top K** | 1 - 200 | Limits token choices to top K candidates |
| **Max Tokens** | 64 - 32768 | Maximum response length |
| **Frequency Penalty** | -2.0 - 2.0 | Penalises repeated tokens. Higher = less repetition |
| **Presence Penalty** | -2.0 - 2.0 | Penalises tokens already used. Higher = more topic diversity |
| **Reasoning Effort** | minimal / low / medium / high | How long a reasoning model should think before answering |

Press **Enter** on a parameter to cycle through values. Numeric parameters step through their range and wrap back to the default. **Reasoning Effort** cycles `minimal → low → medium → high` and then wraps back to the default (unset), so you can return to sending nothing without resetting everything.

Select **Reset All to Defaults** to clear all parameter overrides.

Reasoning Effort is provider-dependent — see [Reasoning Effort](#reasoning-effort) below.

### Reasoning Effort

`reasoningEffort` controls how much a reasoning model thinks before answering. Nanocoder maps it to the mechanism the active provider understands:

- **openai-compatible** providers — forwarded as the request body field `reasoning_effort`.
- **openrouter** — mapped to `reasoning.effort` in `providerOptions`.
- **chatgpt-codex** (OpenAI Responses API) — mapped to `providerOptions.openai`.

Accepted values are `minimal`, `low`, `medium`, and `high`.

What happens when it is unset depends on the provider:

- **openai-compatible** and **openrouter** — nothing is sent, which is what you want for models that reject the field.
- **chatgpt-codex** — falls back to `medium`, since the Responses API expects a reasoning hint to emit traces.

A provider-specific reasoning block still wins where they overlap: an explicit `openrouter.reasoning.effort` beats this value, and for `chatgpt-codex` `medium` is only a fallback. See [ChatGPT/Codex](../configuration/providers/chatgpt-codex.md).

Set it from the `/tune` modal (**Model Parameters → Reasoning Effort**) or in `agents.config.json`:

```json
{
	"nanocoder": {
		"tune": {
			"modelParameters": {
				"reasoningEffort": "high"
			}
		}
	}
}
```

> **This is a global setting, not a per-provider one.** It applies to whichever provider is active, so leave it unset if you also use models that reject the field.

#### Overriding parameters from agents.config.json

`tune.modelParameters` resolves as a **whole object per layer** — not key by key. The highest-priority layer that defines `modelParameters` at all replaces the entire object from lower layers, so unlisted keys are not inherited.

With the config above, setting **Temperature** in the `/tune` modal saves `modelParameters.temperature` to `nanocoder-preferences.json`. But `agents.config.json` defines `modelParameters` too, so its object wins outright and the temperature is dropped — the request goes out with `reasoning_effort: "high"` and no temperature.

To keep both, put them in the same layer. Either list every parameter in `agents.config.json`:

```json
{
	"nanocoder": {
		"tune": {
			"modelParameters": {
				"reasoningEffort": "high",
				"temperature": 0.7
			}
		}
	}
}
```

...or leave `modelParameters` out of `agents.config.json` entirely and set everything from the modal.

### Provider-specific parameters

Fields that are not settable from the `/tune` modal are configured through `agents.config.json`:

- **`reasoningSummary`** — `auto` | `concise` | `detailed`. Controls how much reasoning text the `chatgpt-codex` provider returns.

OpenRouter exposes additional always-on request body fields (provider routing, plugins, service tier, fallback models, etc) on the provider config itself — see [OpenRouter request options](../configuration/providers/openrouter.md#openrouter-request-options). Those settings are not tied to tune and apply on every request.

## Presets

Three built-in presets are available via **Load Preset**:

| Preset | Settings |
|--------|----------|
| **Default** | Resets everything to defaults (auto profile, tune enabled) |
| **Small Model** | Minimal tool profile, aggressive compact, temperature 0.7 |
| **Nano (low-end hardware)** | Nano profile, aggressive compact, AGENTS.md off, temperature 0.4, max tokens 2048 |

Selecting a preset populates the tune form — you can further adjust settings before applying.

## Configuration Layers

Tune settings resolve from four layers, applied in order — each layer overrides the ones before it, so the **last** layer to set a field wins:

1. **Hardcoded defaults** — `enabled: true`, `toolProfile: 'auto'`, `aggressiveCompact: false`
2. **Preferences** — saved via the `/tune` UI to `nanocoder-preferences.json`
3. **Top-level config** — `tune` in `agents.config.json`
4. **Session override** — runtime changes in the current session

In other words, `agents.config.json` outranks anything you saved through the modal, and a change applied in the current session outranks both.

> For `modelParameters` specifically, the winning layer replaces the whole object rather than merging key by key — see [Overriding parameters from agents.config.json](#overriding-parameters-from-agentsconfigjson) above.

### Per-provider tune is not supported

A `tune` block inside an individual provider's configuration has no effect. The per-provider layer exists in the merge function's signature, but no production code path supplies it: providers are loaded into the resolved config without copying `tune`, and every caller resolves tune with the per-provider argument left undefined.

To vary settings per provider, switch provider and adjust `/tune`, or run separate projects with their own `agents.config.json`.

## Interaction with Development Modes

Tune works alongside [development modes](development-modes.md):

- **Plan mode + minimal profile** — the model gets 4 exploration tools (`read_file`, `find_files`, `search_file_contents`, `list_directory`), making it practical for small models to plan
- **Plan mode + nano profile** — the model gets `read_file` and `search_file_contents` for exploration, with the shortened plan-mode prompt
- **Plan mode + full profile** — all plan-mode tools are available, including read-only git, diagnostics, web, and interaction tools
- Mode exclusions are filtered on top of the tune profile

## Status Bar

When tune is active, the status bar shows the **resolved** tool profile, so you can see what `auto` picked for the current model:

```
tune: minimal (auto)
```

With an explicit profile the `(auto)` suffix is omitted (`tune: full`). On narrow terminals the suffix is dropped to save space.

## Related

- [Development Modes](development-modes.md) — normal, auto-accept, yolo, plan, and architect modes
- [Context Compression](context-compression.md) — how compaction works
- [Commands Reference](commands.md) — all slash commands
- [Configuration](../configuration/index.md) — `agents.config.json` reference
- [Custom Provider](../configuration/providers/custom.md) — forwarding `reasoning_effort` to OpenAI-compatible APIs
- [ChatGPT / Codex](../configuration/providers/chatgpt-codex.md) — reasoning traces and `reasoningSummary`

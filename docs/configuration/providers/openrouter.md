---
title: "OpenRouter"
description: "Configure OpenRouter as a cloud AI provider for Nanocoder"
sidebar_order: 10
---

# OpenRouter

[OpenRouter](https://openrouter.ai) provides a unified API to access models from OpenAI, Anthropic, Google, Meta, and many other providers through a single endpoint.

## Configuration

```json
{
	"name": "OpenRouter",
	"baseUrl": "https://openrouter.ai/api/v1",
	"apiKey": "your-openrouter-api-key",
	"models": ["provider/model-name"]
}
```

## Setup

1. Create an account at [openrouter.ai](https://openrouter.ai)
2. Generate an API key from the [keys page](https://openrouter.ai/keys)
3. Browse available models at [openrouter.ai/models](https://openrouter.ai/models)

Model names follow the format `provider/model-name`.

## OpenRouter request options

Nanocoder forwards OpenRouter-specific request body fields through an `openrouter` block on the provider config. These are **always-on** for the OpenRouter provider — they are not gated by [tune](../../features/tune.md), so routing rules apply on every request regardless of session state.

The provider is detected by name — any provider entry called `openrouter` (case-insensitive) picks these options up. If you put an `openrouter` block on a provider with a different name, nanocoder logs a warning at startup so the misconfiguration is visible immediately.

> **How this compares to `tune`.** Tune covers runtime model behaviour (temperature, tool profile, compaction, reasoning effort) and can be toggled or persisted per-session via the `/tune` modal. The `openrouter` block covers transport and routing concerns (which upstream provider serves the request, at what tier, with which fallbacks) — these are static, file-only, and never disabled. The one bridge between them is `tune.modelParameters.reasoningEffort`, which populates `openrouter.reasoning.effort` when the latter is unset. Explicit values on the provider config always win.

```json
{
	"providers": [
		{
			"name": "OpenRouter",
			"baseUrl": "https://openrouter.ai/api/v1",
			"apiKey": "${OPENROUTER_API_KEY}",
			"models": ["anthropic/claude-4.5-sonnet"],
			"openrouter": {
				"provider": {"sort": "price", "allow_fallbacks": true},
				"reasoning": {"effort": "high"},
				"service_tier": "flex"
			}
		}
	]
}
```

| Field | Type | Description |
|-------|------|-------------|
| `provider` | object | Provider routing rules (see below) |
| `reasoning` | object | Reasoning token controls (`effort`, `max_tokens`, `exclude`, `enabled`) |
| `plugins` | object[] | OpenRouter plugin pipeline (replaces the legacy `transforms` field) |
| `models` | string[] | Fallback model list, tried in order if the primary model fails |
| `service_tier` | `"flex" \| "priority"` | Pricing/latency tier — `flex` is cheaper/slower, `priority` is faster/pricier |
| `route` | `"fallback"` | Top-level routing toggle |
| `user` | string | Stable end-user identifier passed to upstream providers |
| `extraBody` | object | Escape hatch for arbitrary OpenRouter body fields not yet typed |

> The per-section examples below show only the `openrouter` slice. In your `agents.config.json`, that slice sits inside the OpenRouter provider entry alongside `name`, `baseUrl`, `apiKey`, and `models` — see the full example above.

### Provider routing

```json
{
	"openrouter": {
		"provider": {
			"order": ["Anthropic", "OpenAI"],
			"allow_fallbacks": false,
			"require_parameters": true,
			"data_collection": "deny",
			"sort": "throughput",
			"only": ["Anthropic"],
			"ignore": ["DeepInfra"],
			"quantizations": ["bf16", "fp16"],
			"zdr": true,
			"enforce_distillable_text": true,
			"max_price": {"prompt": 0.5, "completion": 1.5},
			"preferred_min_throughput": {"p90": 30},
			"preferred_max_latency": 2000
		}
	}
}
```

| Field | Type | Notes |
|-------|------|-------|
| `order` | string[] | Preferred provider order |
| `allow_fallbacks` | boolean | Fall back to other providers if preferred ones fail |
| `require_parameters` | boolean | Only use providers that support every parameter you send |
| `data_collection` | `"allow" \| "deny"` | Restrict to providers honouring the chosen policy |
| `only` | string[] | Whitelist providers |
| `ignore` | string[] | Blacklist providers |
| `quantizations` | string[] | Only providers serving the listed quantisations |
| `sort` | string \| object | Either `"price"`, `"throughput"`, `"latency"`, or `{"by": …, "partition": "model"\|"none"}` for cross-model fallback sorting |
| `zdr` | boolean | Enforce Zero Data Retention |
| `enforce_distillable_text` | boolean | Skip providers that apply lossy text transforms |
| `max_price` | object | Cap pricing per `prompt` / `completion` / `request` / `image` |
| `preferred_min_throughput` | number \| `{p50,p75,p90,p99}` | Throughput floor (tokens/s) |
| `preferred_max_latency` | number \| `{p50,p75,p90,p99}` | Latency ceiling (ms) |

Full reference: [openrouter.ai/docs/features/provider-routing](https://openrouter.ai/docs/features/provider-routing).

### Reasoning tokens

```json
{
	"openrouter": {
		"reasoning": {
			"effort": "xhigh",
			"max_tokens": 8000,
			"exclude": false,
			"enabled": true
		}
	}
}
```

`effort` accepts `"xhigh"`, `"high"`, `"medium"`, `"low"`, `"minimal"`, or `"none"`.

The cross-provider `tune.modelParameters.reasoningEffort` field (`minimal | low | medium | high`) is also honoured for OpenRouter — it maps to `reasoning.effort` automatically. An explicit `openrouter.reasoning.effort` on the provider config wins over the tune shortcut.

Full reference: [openrouter.ai/docs/use-cases/reasoning-tokens](https://openrouter.ai/docs/use-cases/reasoning-tokens).

### Plugins

The OpenRouter plugin pipeline replaces the legacy top-level `transforms` field. Pass an array of plugin objects, each with an `id`:

```json
{
	"openrouter": {
		"plugins": [
			{"id": "context-compression", "engine": "middle-out"},
			{"id": "web"}
		]
	}
}
```

### Fallback models

`models` declares an ordered fallback list. OpenRouter tries each in turn if the primary model returns an error or is unavailable:

```json
{
	"openrouter": {
		"models": ["anthropic/claude-3.5-sonnet", "openai/gpt-4o"]
	}
}
```

See [openrouter.ai/docs/features/model-routing](https://openrouter.ai/docs/features/model-routing).

### Service tier

```json
{
	"openrouter": {
		"service_tier": "flex"
	}
}
```

`flex` routes through cheaper, higher-latency capacity. `priority` is more expensive with lower latency. Reference: [openrouter.ai/docs/guides/features/service-tiers](https://openrouter.ai/docs/guides/features/service-tiers).

### Generic body pass-through

For OpenRouter body fields that don't have a dedicated typed entry yet, use `extraBody`. It's shallow-merged into the request body before the typed fields above, so typed fields win on key conflicts:

```json
{
	"openrouter": {
		"extraBody": {
			"debug": {"echo_upstream_body": true}
		}
	}
}
```

This is an escape hatch — prefer the typed fields when one exists.

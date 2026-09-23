---
title: "Custom Provider"
description: "Configure any OpenAI-compatible API as a custom provider for Nanocoder"
sidebar_order: 30
---

# Custom Provider

Any service that exposes an OpenAI-compatible API can be added as a custom provider.

## Configuration

```json
{
	"name": "My Provider",
	"baseUrl": "https://my-api.example.com/v1",
	"apiKey": "optional-api-key",
	"caCertPath": "/path/to/internal-ca.pem",
	"models": ["model-name"]
}
```

## Optional Fields

Custom providers support all [provider configuration fields](index.md#provider-configuration-fields), including:

- `requestTimeout` - Overall request timeout in milliseconds
- `socketTimeout` - Socket-level timeout (use `-1` for no timeout)
- `disableTools` - Disable tool calling for this provider
- `disableToolModels` - Disable tool calling for specific models
- `caCertPath` - Path to a PEM CA bundle for self-signed or privately issued TLS certificates

## Reasoning Effort

For a reasoning model, set `tune.modelParameters.reasoningEffort`. Nanocoder forwards it as `reasoning_effort` in the request body:

```json
{
	"nanocoder": {
		"providers": [
			{
				"name": "My Provider",
				"baseUrl": "https://my-api.example.com/v1",
				"apiKey": "your-api-key",
				"models": ["my-model"]
			}
		],
		"tune": {
			"modelParameters": {
				"reasoningEffort": "high"
			}
		}
	}
}
```

Accepted values are `"minimal"`, `"low"`, `"medium"`, and `"high"`. When the field is unset, no `reasoning_effort` is sent.

You can also set it interactively from `/tune`, under **Model Parameters → Reasoning Effort**. Note that `tune` is a global setting, not a per-provider one — it applies to whichever provider is active. Leave it unset if you also use models that reject the field.

One caveat when setting some parameters in the config file and others in `/tune`: a `modelParameters` object in `agents.config.json` replaces the whole object rather than merging key by key, so values set in the modal can be dropped. See [Overriding parameters from agents.config.json](../features/tune.md#overriding-parameters-from-agentsconfigjson).

## Setup via Wizard

Select "Custom Provider" in the `/settings providers` wizard to add one interactively. The wizard will prompt for:

1. Provider name
2. Base URL
3. API key (optional)
4. Model names
5. Request timeout

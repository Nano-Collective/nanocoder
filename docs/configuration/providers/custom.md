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
	"nanocoder": {
		"providers": [
			{
				"name": "My Provider",
				"baseUrl": "https://my-api.example.com/v1",
				"apiKey": "optional-api-key",
				"caCertPath": "/path/to/internal-ca.pem",
				"models": ["model-name"]
			}
		]
	}
}
```

## Optional Fields

Custom providers support all [provider configuration fields](index.md#provider-configuration-fields), including:

- `requestTimeout` - Timeout in milliseconds, used when `socketTimeout` is not set
- `socketTimeout` - Connect, header and body timeout (use `-1` for no timeout). See [Timeouts](index.md#timeouts--connection-pooling)
- `disableTools` - Disable tool calling for this provider
- `disableToolModels` - Disable tool calling for specific models
- `caCertPath` - Path to a PEM CA bundle for self-signed or privately issued TLS certificates

## Reasoning Effort

For a reasoning model served through the default OpenAI-compatible SDK, set `reasoningEffort` in the top-level tune configuration:

```json
{
	"nanocoder": {
		"providers": [
			{
				"name": "My Provider",
				"baseUrl": "https://my-api.example.com/v1",
				"apiKey": "your-api-key",
				"models": ["my-reasoning-model"]
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

Nanocoder forwards the value as `reasoning_effort` in the request body. Accepted values are `"minimal"`, `"low"`, `"medium"`, and `"high"`. When the setting is absent, Nanocoder sends no `reasoning_effort` field, preserving compatibility with providers and models that reject it.

See [Tune](../../features/tune.md#provider-specific-parameters) for configuration precedence and the provider-specific mappings.

## Setup via Wizard

Select "Custom Provider" in the `/settings providers` wizard to add one interactively. The wizard will prompt for:

1. Provider name
2. Base URL
3. API key (optional)
4. Model names
5. Request timeout (optional, saved as `requestTimeout`; leave blank to keep the default)

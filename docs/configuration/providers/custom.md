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
	"models": ["model-name"],
	"extraBody": {"top_k": 40, "chat_template_kwargs": {"enable_thinking": false}}
}
```

`extraBody` forwards additional JSON fields to OpenAI-compatible chat endpoints. It is useful for endpoint-specific parameters that Nanocoder does not model; the active model, messages, tools, and streaming mode remain controlled by Nanocoder. Values support the same environment-variable substitution as other provider settings.

## Optional Fields

Custom providers support all [provider configuration fields](index.md#provider-configuration-fields), including:

- `requestTimeout` - Timeout in milliseconds, used when `socketTimeout` is not set
- `socketTimeout` - Connect, header and body timeout (use `-1` for no timeout). See [Timeouts](index.md#timeouts--connection-pooling)
- `disableTools` - Disable tool calling for this provider
- `disableToolModels` - Disable tool calling for specific models
- `includeUsage` - Request streaming token usage metrics (default: `true`). Set to `false` for proxies that reject `stream_options`
- `extraBody` - Additional request-body fields for OpenAI-compatible chat endpoints
- `caCertPath` - Path to a PEM CA bundle for self-signed or privately issued TLS certificates

## Setup via Wizard

Select "Custom Provider" in the `/settings providers` wizard to add one interactively. The wizard will prompt for:

1. Provider name
2. Base URL
3. API key (optional)
4. Model names
5. Request timeout (optional, saved as `requestTimeout`; leave blank to keep the default)

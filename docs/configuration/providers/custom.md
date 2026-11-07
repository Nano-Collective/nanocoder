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

- `requestTimeout` - Timeout in milliseconds, used when `socketTimeout` is not set
- `socketTimeout` - Connect, header and body timeout (use `-1` for no timeout). See [Timeouts](index.md#timeouts--connection-pooling)
- `disableTools` - Disable tool calling for this provider
- `disableToolModels` - Disable tool calling for specific models
- `includeUsage` - Request streaming token usage metrics (default: `true`). Set to `false` for proxies that reject `stream_options`
- `caCertPath` - Path to a PEM CA bundle for self-signed or privately issued TLS certificates

## Setup via Wizard

Select "Custom Provider" in the `/settings providers` wizard to add one interactively. The wizard will prompt for:

1. Provider name
2. Base URL
3. API key (optional)
4. Model names
5. Request timeout (optional, saved as `requestTimeout`; leave blank to keep the default)

## Example: Tsubasa

[Tsubasa](https://tsubasa.sh) provides OpenAI-compatible API access. To configure it as a custom provider:

```json
{
	"name": "Tsubasa",
	"baseUrl": "https://api.tsubasa.sh/v1",
	"apiKey": "your-tsubasa-api-key",
	"models": ["tsubasa-pro", "tsubasa-fast"],
	"disableTools": true
}
```

Both `tsubasa-pro` and `tsubasa-fast` support a 32,768-token context window with an 8,192-token output limit. Tool calling is currently unsupported, so `disableTools: true` is required.

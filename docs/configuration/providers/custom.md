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
	"models": ["model-name"]
}
```

## Optional Fields

Custom providers support all [provider configuration fields](index.md#provider-configuration-fields), including:

- `requestTimeout` - Overall request timeout in milliseconds
- `socketTimeout` - Socket-level timeout (use `-1` for no timeout)
- `disableTools` - Disable tool calling for this provider
- `disableToolModels` - Disable tool calling for specific models

## Setup via Wizard

Select "Custom Provider" in the `/setup-providers` wizard to add one interactively. The wizard will prompt for:

1. Provider name
2. Base URL
3. API key (optional)
4. Model names
5. Request timeout

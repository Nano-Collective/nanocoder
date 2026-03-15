---
title: "Anthropic Claude"
description: "Configure Anthropic Claude as a native AI provider for Nanocoder"
sidebar_order: 20
---

# Anthropic Claude

Use Anthropic's Claude models with native API support via `@ai-sdk/anthropic`.

## Configuration

```json
{
	"name": "Anthropic",
	"sdkProvider": "anthropic",
	"baseUrl": "https://api.anthropic.com/v1",
	"apiKey": "your-anthropic-api-key",
	"models": ["your-model-name"]
}
```

The `sdkProvider: "anthropic"` field enables the native Anthropic SDK instead of the OpenAI-compatible layer.

## Setup

1. Create an account at [console.anthropic.com](https://console.anthropic.com)
2. Generate an API key from the [API keys page](https://console.anthropic.com/settings/keys)

## Fetching Available Models

The `/setup-providers` wizard can automatically fetch available models from your Anthropic account.

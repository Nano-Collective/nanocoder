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

## Prompt caching

Prompt caching is enabled by default on this provider. Nanocoder marks the
stable prefix of each request — tool schemas and the system prompt — with an
Anthropic cache breakpoint, plus one on the final message of the turn, so the
next turn reads that prefix back out of cache instead of resending it at full
price. Prompts below Anthropic's minimum cacheable length are sent unmarked.

Cost reporting is cache-aware: `/usage` and the per-response indicator price
cache reads and writes at their own rates rather than the full input rate. The
per-response indicator also shows the cached token count alongside the total,
e.g. `Tokens: 12.4k | 9.8k cached | ~$0.02`.

Opt out per provider:

```json
{
	"name": "Anthropic",
	"sdkProvider": "anthropic",
	"apiKey": "your-anthropic-api-key",
	"models": ["your-model-name"],
	"promptCaching": false
}
```

Other providers are unaffected: OpenAI and OpenRouter cache prefixes
automatically, and local models have no cache to address.

## Setup

1. Create an account at [console.anthropic.com](https://console.anthropic.com)
2. Generate an API key from the [API keys page](https://console.anthropic.com/settings/keys)

## Fetching Available Models

The `/settings providers` wizard can automatically fetch available models from your Anthropic account.

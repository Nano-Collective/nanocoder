---
title: "WorldRouter"
description: "Configure WorldRouter as a cloud AI provider for Nanocoder"
sidebar_order: 32
---

# WorldRouter

[WorldRouter](https://www.worldrouter.ai) provides an OpenAI-compatible API at `https://inference-api.worldrouter.ai/v1` that gives access to Claude, GPT, Gemini, DeepSeek, Kimi and GLM models with a single API key, billed per token. Nanocoder uses its existing OpenAI-compatible client with the WorldRouter endpoint, so no extra SDK is needed.

## Configuration

```json
{
	"name": "WorldRouter",
	"baseUrl": "https://inference-api.worldrouter.ai/v1",
	"apiKey": "${WORLDROUTER_API_KEY}",
	"models": ["claude-sonnet-5-5"]
}
```

## Setup

1. [Create a WorldRouter API key](https://www.worldrouter.ai/dashboard/api-keys).
2. Enter the key in the `/settings providers` wizard. For a manual configuration, set `WORLDROUTER_API_KEY` in your environment and reference it with `${WORLDROUTER_API_KEY}` as shown above. Nanocoder resolves that reference; it does not read the variable automatically.
3. Pick the exact model IDs you want, for example `claude-sonnet-5-5`, `deepseek-v4-flash` or `gemini-4-neon`. Model IDs have no vendor prefix and are passed through unchanged. See the [WorldRouter model catalog](https://www.worldrouter.ai/models) for current IDs and prices.

## Fetching Available Models

The `/settings providers` wizard can fetch models from your WorldRouter account after you provide a key. The list also includes image and video generation models, which Nanocoder cannot use, so pick a chat model.

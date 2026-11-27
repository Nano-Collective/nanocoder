---
title: "TeamoRouter"
description: "Configure TeamoRouter as a cloud AI provider for Nanocoder"
sidebar_order: 32
---

# TeamoRouter

[TeamoRouter](https://teamorouter.com/) is an OpenAI-compatible API gateway at `https://api.teamorouter.com/v1` for GLM, Kimi, DeepSeek, Qwen, Claude, GPT and Gemini models on one key. Nanocoder uses its existing OpenAI-compatible client with the TeamoRouter endpoint, so no extra SDK is needed.

## Configuration

```json
{
	"name": "TeamoRouter",
	"baseUrl": "https://api.teamorouter.com/v1",
	"apiKey": "${TEAMOROUTER_API_KEY}",
	"models": ["glm-5.3"]
}
```

## Setup

1. Create an account and an API key on the API Keys page of the [TeamoRouter dashboard](https://teamorouter.com/dashboard?tab=api-keys).
2. Enter the key in the `/settings providers` wizard. For a manual configuration, set `TEAMOROUTER_API_KEY` in your environment and reference it with `${TEAMOROUTER_API_KEY}` as shown above. Nanocoder resolves that reference; it does not read the variable automatically.
3. Pick the exact model IDs you want, for example `glm-5.3`, `kimi-k3.1-pro` or `deepseek-v4-pro`. Model IDs have no vendor prefix. The catalog with prices is available at `https://api.teamorouter.com/v1/models/pricing` without a key.

The wizard can fetch available models from the TeamoRouter endpoint after you provide a key.

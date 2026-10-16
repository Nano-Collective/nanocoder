---
title: "API Route"
description: "Configure API Route as a cloud AI provider for Nanocoder"
sidebar_order: 27
---

# API Route

[API Route](https://www.api-route.com/) provides an OpenAI-compatible API for models from multiple providers. Nanocoder uses its existing OpenAI-compatible client with the API Route endpoint.

## Configuration

```json
{
	"name": "API Route",
	"baseUrl": "https://global.api-route.com/v1",
	"apiKey": "${API_ROUTE_API_KEY}",
	"models": ["gpt-5.5"]
}
```

## Setup

1. Create an account and an API key at [API Route](https://www.api-route.com/).
2. Enter the key in the `/settings providers` wizard. For a manual configuration, set `API_ROUTE_API_KEY` in your environment and reference it with `${API_ROUTE_API_KEY}` as shown above. Nanocoder resolves that reference; it does not read the variable automatically.
3. Select the exact model ID from the [model catalog](https://www.api-route.com/pricing). The example uses `gpt-5.5`.

The wizard can fetch available models from the API Route endpoint after you provide a key.

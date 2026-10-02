---
title: "Y-API"
description: "Configure Y-API as a cloud AI provider for Nanocoder"
sidebar_order: 28
---

# Y-API

[Y-API](https://y-api.bestvirtualgoods.com/) is an OpenAI-compatible gateway that gives you a single endpoint and API key to reach models from several upstream providers. Because it speaks the OpenAI Chat Completions API, including streaming and tool calling, it works as a drop-in coding provider for Nanocoder.

## Configuration

```json
{
	"name": "Y-API",
	"baseUrl": "https://api.y-api.bestvirtualgoods.com/v1",
	"apiKey": "${YAPI_API_KEY}",
	"models": ["deepseek/deepseek-v4-flash"]
}
```

## Setup

1. Create an API key on the [API keys page](https://y-api.bestvirtualgoods.com/app/keys)
2. Enter the key in the `/settings providers` wizard. For a manual configuration, set `YAPI_API_KEY` in your environment and reference it with `${YAPI_API_KEY}` as shown above. Nanocoder resolves that reference; it does not read the variable automatically.

## Models

Model IDs use the `provider/model` form and are passed through to the gateway unchanged, for example:

- `deepseek/deepseek-v4-flash`
- `anthropic/claude-sonnet-5`

Which IDs a key can use depends on the account behind it, so check the [model catalog](https://y-api.bestvirtualgoods.com/models) or ask the gateway directly. The `/settings providers` wizard can fetch available models for your key from `GET /v1/models`; the same request without a key returns 401, so this works only once a key is configured.

The gateway also exposes an Anthropic-compatible `POST /v1/messages` endpoint. Nanocoder does not use it: this template sets no `sdkProvider`, so requests go through the existing OpenAI-compatible client.

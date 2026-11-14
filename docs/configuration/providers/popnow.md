---
title: "PopNow"
description: "Configure PopNow as a cloud AI provider for Nanocoder"
sidebar_order: 31
---

# PopNow

[PopNow](https://popnow.ai/api) provides an OpenAI-compatible API that gives access to chat models from DeepSeek, Moonshot, Google, OpenAI, Anthropic and other vendors with a single API key, billed per token in USD.

## Configuration

```json
{
	"name": "PopNow",
	"baseUrl": "https://api.popnow.ai/v1",
	"apiKey": "${POPNOW_API_KEY}",
	"models": ["deepseek/v4-flash/chat"]
}
```

## Setup

1. [Create a PopNow API key](https://popnow.ai/api/console/keys)
2. Paste the key into the wizard, or set `POPNOW_API_KEY` in your environment and reference it with `${POPNOW_API_KEY}`. Nanocoder resolves that reference; it does not read the variable automatically

## Models

Model names are passed through unchanged. PopNow model IDs end in a task suffix, and Nanocoder needs the ones ending in `/chat`, for example:

- `deepseek/v4-flash/chat`
- `moonshot/kimi-k3/chat`
- `google/gemini-3.7-flash/chat`
- `anthropic/claude-sonnet-5.5/chat`

See the [PopNow model catalog](https://popnow.ai/api/models) for current IDs and prices.

## Fetching Available Models

The `/settings providers` wizard can fetch models from your PopNow account. The list also includes image, video and audio models, which Nanocoder cannot use, so pick an ID ending in `/chat`.

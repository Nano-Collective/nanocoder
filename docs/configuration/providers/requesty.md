---
title: "Requesty"
description: "Configure Requesty as a cloud AI provider for Nanocoder"
sidebar_order: 18
---

# Requesty

[Requesty](https://requesty.ai) is an OpenAI-compatible LLM router that gives you a single endpoint and API key to access models from OpenAI, Anthropic, Google, Meta, and many other providers. Because it speaks the OpenAI Chat Completions API, it works as a drop-in coding provider for Nanocoder.

## Configuration

```json
{
	"name": "Requesty",
	"baseUrl": "https://router.requesty.ai/v1",
	"apiKey": "${REQUESTY_API_KEY}",
	"models": ["openai/gpt-4o-mini"]
}
```

## Setup

1. Create an account at [requesty.ai](https://requesty.ai)
2. Generate an API key from the [API keys page](https://app.requesty.ai/api-keys)
3. Browse available models in the [model list](https://app.requesty.ai/router/list)

Model names follow the `provider/model-name` format, e.g. `openai/gpt-4o-mini` or `anthropic/claude-3.5-sonnet`.

## Fetching Available Models

The `/setup-providers` wizard can automatically fetch available models from your Requesty account.

See the [Requesty documentation](https://docs.requesty.ai) for the full model catalog and routing options.

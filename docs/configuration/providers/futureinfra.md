---
title: "FutureInfra"
description: "Configure FutureInfra as a cloud AI provider for Nanocoder"
sidebar_order: 27
---

# FutureInfra

[FutureInfra](https://futureinfra.ai/) is a Korean cloud provider whose AI API router gives you a single OpenAI-compatible endpoint and API key for models from several upstream providers. Because it speaks the OpenAI Chat Completions API, including streaming and tool calling, it works as a drop-in coding provider for Nanocoder.

## Configuration

```json
{
	"name": "FutureInfra",
	"baseUrl": "https://futureinfra.ai/v1/ai",
	"apiKey": "${FUTUREINFRA_API_KEY}",
	"models": ["openai/gpt-4o-mini"]
}
```

## Setup

1. Create an account and generate an API key on the [AI router console page](https://futureinfra.ai/console/?screen=ai-router) (keys start with `pk_live_`)
2. Set `FUTUREINFRA_API_KEY`, or paste the key into the wizard

See the [FutureInfra AI docs](https://futureinfra.ai/ai/) and the [general docs](https://futureinfra.ai/docs/) for account setup.

## Models

Model names use the `provider/model` form and are passed through to the router unchanged, for example:

- `openai/gpt-4o-mini`
- `openai/gpt-4o`
- `anthropic/claude-sonnet-4`
- `google/gemini-2.5-flash`
- `deepseek/deepseek-chat`

The current catalog is available at `https://futureinfra.ai/v1/ai/models`. Enter the model IDs you want in the wizard's model field, separated by commas.

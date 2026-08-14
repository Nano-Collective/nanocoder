---
title: "OrcaRouter"
description: "Configure OrcaRouter as a cloud AI provider for Nanocoder"
sidebar_order: 19
---

# OrcaRouter

[OrcaRouter](https://www.orcarouter.ai) is an OpenAI-compatible LLM router that gives you a single endpoint and API key to access models from OpenAI, Anthropic, Google, Meta, and many other providers. Because it speaks the OpenAI Chat Completions API, it works as a drop-in coding provider for Nanocoder.

## Configuration

```json
{
	"name": "OrcaRouter",
	"baseUrl": "https://api.orcarouter.ai/v1",
	"apiKey": "${ORCAROUTER_API_KEY}",
	"models": ["openai/gpt-5.5"]
}
```

## Setup

1. Create an account at [orcarouter.ai](https://www.orcarouter.ai)
2. Generate an API key from the [console](https://www.orcarouter.ai/console)
3. Browse available models in the [model list](https://www.orcarouter.ai/models)

Model names follow the `provider/model-name` format, e.g. `openai/gpt-5.5` or `anthropic/claude-sonnet-5`.

## Fetching Available Models

The `/setup-providers` wizard can automatically fetch available models from your OrcaRouter account.

See the [OrcaRouter docs](https://docs.orcarouter.ai) for the full model catalog and routing options.

---
title: "Together AI"
description: "Configure Together AI as a cloud AI provider for Nanocoder"
sidebar_order: 19
---

# Together AI

[Together AI](https://together.ai) provides fast inference for open-source AI models through an OpenAI-compatible API. Use it to run models for chat completions, function calling, structured outputs, and reasoning support.

## Configuration

```json
{
	"name": "Together AI",
	"baseUrl": "https://api.together.ai/v1",
	"apiKey": "your-together-api-key",
	"models": ["your-model-name"]
}
```

Together AI model IDs are namespaced (e.g. `deepseek-ai/DeepSeek-V3`, `meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8`). Browse the full list at [Available models](https://docs.together.ai/docs/serverless/models).

## Setup

1. Create an account at [api.together.ai](https://api.together.ai)
2. Generate an API key from your [settings page](https://api.together.ai/settings/projects/~current/api-keys)
3. Choose a model from the [model catalog](https://docs.together.ai/docs/serverless/models)

## Fetching Available Models

The `/setup-providers` wizard can automatically fetch available models from your Together AI account.
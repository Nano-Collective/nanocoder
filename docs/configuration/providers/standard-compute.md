---
title: "Standard Compute"
description: "Configure Standard Compute as a cloud AI provider for Nanocoder"
sidebar_order: 29
---

# Standard Compute

[Standard Compute](https://standardcompute.com) is an OpenAI-compatible API that gives you one endpoint and API key for models from Anthropic, OpenAI, Google, DeepSeek, Moonshot, Z.ai, Qwen and others. Its `standardcompute` model routes each request to a model and provider; you can also pin a specific model. Because it speaks the OpenAI Chat Completions API, including streaming and tool calling, it works as a drop-in coding provider for Nanocoder.

## Configuration

```json
{
	"name": "Standard Compute",
	"baseUrl": "https://api.stdcmpt.com/v1",
	"apiKey": "${STANDARDCOMPUTE_API_KEY}",
	"models": ["standardcompute"]
}
```

## Setup

1. Create an account at [standardcompute.com](https://standardcompute.com)
2. Create an API key on the [API keys page](https://standardcompute.com/dashboard/api-keys)
3. Set `STANDARDCOMPUTE_API_KEY`, or paste the key into the wizard

## Models

- `standardcompute` lets the router choose the model for each request
- Pinned models use the `provider/model` form, for example:
  - `anthropic/claude-sonnet-5.5`
  - `openai/gpt-6.1-sol`
  - `google/gemini-4-argon`
  - `deepseek/deepseek-v4-pro`
  - `moonshotai/kimi-k3`
  - `z-ai/glm-5.3`

The current catalog is available at `https://api.stdcmpt.com/v1/models`. See the [Standard Compute docs](https://docs.standardcompute.com) for details.

## Fetching Available Models

The `/settings providers` wizard can automatically fetch available models from your Standard Compute account.

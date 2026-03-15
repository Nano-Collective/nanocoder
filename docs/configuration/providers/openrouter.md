---
title: "OpenRouter"
description: "Configure OpenRouter as a cloud AI provider for Nanocoder"
sidebar_order: 10
---

# OpenRouter

[OpenRouter](https://openrouter.ai) provides a unified API to access models from OpenAI, Anthropic, Google, Meta, and many other providers through a single endpoint.

## Configuration

```json
{
	"name": "OpenRouter",
	"baseUrl": "https://openrouter.ai/api/v1",
	"apiKey": "your-openrouter-api-key",
	"models": ["provider/model-name"]
}
```

## Setup

1. Create an account at [openrouter.ai](https://openrouter.ai)
2. Generate an API key from the [keys page](https://openrouter.ai/keys)
3. Browse available models at [openrouter.ai/models](https://openrouter.ai/models)

Model names follow the format `provider/model-name`.

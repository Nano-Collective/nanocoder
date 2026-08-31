---
title: "Groq"
description: "Configure Groq as a cloud AI provider for Nanocoder"
sidebar_order: 19
---

# Groq

[Groq](https://groq.com) serves open-weight models on custom LPU hardware, which makes it one of the fastest ways to run models like GPT-OSS, Llama and Qwen. It exposes an OpenAI-compatible API, so it works as a drop-in coding provider for Nanocoder.

## Configuration

```json
{
	"name": "Groq",
	"baseUrl": "https://api.groq.com/openai/v1",
	"apiKey": "${GROQ_API_KEY}",
	"models": ["openai/gpt-oss-120b"]
}
```

`openai/gpt-oss-120b` is the default the setup wizard suggests. Browse the rest at [Supported models](https://console.groq.com/docs/models).

## Setup

1. Create an account at [console.groq.com](https://console.groq.com)
2. Generate an API key from the [API keys page](https://console.groq.com/keys)
3. Add the provider with `/settings` → **Providers** → **Configure Providers**, or paste the block above into your `agents.config.json`

## Fetching Available Models

The `/settings providers` wizard can automatically fetch available models from your Groq account.

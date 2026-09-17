---
title: "Cheaper Inference"
description: "Configure Cheaper Inference as a cloud AI provider for Nanocoder"
sidebar_order: 26
---

# Cheaper Inference

[Cheaper Inference](https://cheaperinference.com/docs) is an OpenAI-compatible gateway that gives you a single endpoint and API key to reach models from several upstream providers. Because it speaks the OpenAI Chat Completions API, it works as a drop-in coding provider for Nanocoder.

## Configuration

```json
{
	"name": "Cheaper Inference",
	"baseUrl": "https://api.cheaperinference.com/v1",
	"apiKey": "${CHEAPERINFERENCE_API_KEY}",
	"models": ["claude-sonnet-5"]
}
```

## Setup

1. Create an account and generate an API key
2. Set `CHEAPERINFERENCE_API_KEY`, or paste the key into the wizard

See the [Cheaper Inference docs](https://cheaperinference.com/docs) for account setup and the current model catalog.

## Models

Model names are passed through to the gateway unchanged, for example `claude-sonnet-5`
or `deepseek-v4.1-flash`. The documented catalog is:

- `claude-opus-5`
- `claude-sonnet-5`
- `deepseek-v4-flash-0731`
- `deepseek-v4.1-flash`
- `gemini-3.7-flash`
- `glm-5.3`
- `glm-5.3-flash`
- `gpt-5-mini`
- `gpt-5.6-luna`
- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-6-astra`
- `gpt-oss-120b`
- `grok-4.5`
- `kimi-k3`
- `qwen-3-8-max`

## Fetching Available Models

The `/settings providers` wizard can automatically fetch available models from your
Cheaper Inference account.

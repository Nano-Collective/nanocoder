---
title: "Opper"
description: "Configure Opper as a cloud AI provider for Nanocoder"
sidebar_order: 31
---

# Opper

[Opper](https://opper.ai) is an EU-hosted AI gateway that gives you a single endpoint and API key to reach models from OpenAI, Anthropic, Google, Mistral, DeepSeek, Moonshot and open-weight vendors. Because it speaks the OpenAI Chat Completions API, it works as a drop-in coding provider for Nanocoder.

## Configuration

```json
{
	"name": "Opper",
	"baseUrl": "https://api.opper.ai/v3/compat",
	"apiKey": "${OPPER_API_KEY}",
	"models": ["claude-sonnet-4-6"]
}
```

## Setup

1. Create an account at [opper.ai](https://opper.ai)
2. Generate an API key in the [console](https://platform.opper.ai)
3. Set `OPPER_API_KEY`, or paste the key into the wizard

## Models

Model names are bare pool names, for example `claude-sonnet-4-6` or `gpt-5.5`. A pool
is every provider serving that model, and Opper picks the route per request. Commonly
used ids are:

- `claude-sonnet-4-6`
- `claude-opus-5`
- `gpt-5.5`
- `gpt-5.4-mini`
- `gemini-3.8-flash`
- `deepseek-v4-pro`
- `kimi-k3`
- `mistral-large-2512`

A `provider/model` id such as `azure/gpt-5.5` pins one provider or region instead of
using the pool. Browse the full catalog at [opper.ai/models](https://opper.ai/models).

## Fetching Available Models

The `/settings providers` wizard can automatically fetch available models from your
Opper account.

## Data Residency

Opper is hosted in the EU (AWS Stockholm) and requests can be pinned to EU-hosted
regions. See the [Opper docs](https://docs.opper.ai) for the full model catalog and
routing options.

---
title: "LLMTR"
description: "Configure LLMTR as a cloud AI provider for Nanocoder"
sidebar_order: 32
---

# LLMTR

[LLMTR](https://llmtr.com) is a prepaid OpenAI-compatible gateway. One key reaches models from many vendors. Model IDs use the `vendor/model` form, and the API supports streaming and tool calling.

Some models have a free daily quota. The quota, its terms and the list of eligible models are set by LLMTR and can change, so check the [dashboard](https://llmtr.com/dashboard/keys) for what applies to your account.

## Configuration

```json
{
	"name": "LLMTR",
	"baseUrl": "https://llmtr.com/v1",
	"apiKey": "${LLMTR_API_KEY}",
	"models": ["qwen/qwen3.8-27b-free"]
}
```

## Setup

1. Create an API key in the [LLMTR dashboard](https://llmtr.com/dashboard/keys)
2. Paste the key into the wizard, or set `LLMTR_API_KEY` in your environment and reference it with `${LLMTR_API_KEY}`. Nanocoder resolves that reference; it does not read the variable automatically

## Models

Model names use the `vendor/model` form and are passed through unchanged, for example:

- `qwen/qwen3.8-27b-free`
- `minimax/minimax-m3.1-flash`
- `lgai/k-exaone-2.5`
- `nvidia/nemotron-3.5-super-vl-free`

The catalog at `https://llmtr.com/v1/models` lists the models your key can use. Enter the chat model IDs you want in the wizard's model field, separated by commas.

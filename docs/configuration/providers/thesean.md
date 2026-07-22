---
title: "Thesean AI"
description: "Configure Thesean AI as a native AI provider for Nanocoder"
sidebar_order: 25
---

# Thesean AI

[Thesean](https://thesean.ai) provides inference-time optimized models through its Ship endpoint, using an Anthropic-compatible protocol. Ship applies research-driven inference-time optimizations (steering vectors, prompt optimization) for higher quality, lower cost, and better reliability.

## Configuration

```json
{
	"name": "Thesean AI",
	"sdkProvider": "anthropic",
	"baseUrl": "https://api.thesean.ai",
	"apiKey": "your-thesean-api-key",
	"models": ["ship-like/claude-opus-4-8", "ship-like/claude-sonnet-5"]
}
```

The `sdkProvider: "anthropic"` field is required as Thesean's Claude models use the Anthropic Messages API format. The `ship-like/` prefix on model names enables Ship's inference-time optimizations.

## Setup

1. Create an account at [app.thesean.ai](https://app.thesean.ai/)
2. Generate an API key from the dashboard

## Available Models

Use the exact model IDs below in the `model` field:

- `ship-like/claude-opus-4-8` — Maximum capability Claude model
- `ship-like/claude-sonnet-5` — Balanced performance and speed
- `ship-like/claude-haiku-4-5` — Fastest, lowest cost
- `ship-like/gpt-5.6-sol` — GPT model via OpenAI Responses API

> **Note**: The `gpt-5.6-sol` model uses the OpenAI Responses API, not the Anthropic API. If you configure it with `sdkProvider: "anthropic"`, tool calling and responses may not work as expected. Use the Claude models for full Nanocoder compatibility or update your configuration in agents.config.json.

## Pricing

See the [Thesean pricing page](https://docs.thesean.ai/api-reference/models) for current rates. Ship's inference-time optimizations typically reduce costs by ~50% compared to the base model while maintaining equivalent output quality.

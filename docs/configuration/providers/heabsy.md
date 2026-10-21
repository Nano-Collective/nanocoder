---
title: "Heabsy"
description: "Configure Heabsy as a cloud AI provider for Nanocoder"
sidebar_order: 28
---

# Heabsy

[Heabsy](https://heabsy.com/platform) is an OpenAI-compatible inference API for open models, operated by FEYA, s.r.o. (Slovakia). Models in its EEA tier run on dedicated GPUs in EEA data centres with zero data retention, which makes it a coding provider for teams whose code must stay in Europe.

## Configuration

```json
{
	"name": "Heabsy",
	"baseUrl": "https://api.heabsy.com/v1",
	"apiKey": "${HEABSY_API_KEY}",
	"models": ["qwen38"]
}
```

## Setup

1. Sign in to the [Heabsy console](https://platform.heabsy.com) and create an API key.
2. Paste the key into the `/settings providers` wizard, or export `HEABSY_API_KEY` and reference it as `"${HEABSY_API_KEY}"` in `apiKey` as shown above.

See the [Heabsy model catalog](https://heabsy.com/models) for prices and for which models run in the EEA tier.

## Models

Model names are passed through unchanged, for example `qwen38` (Qwen3.8 27B, EEA tier, 262k context, tool calling).

## Fetching Available Models

The `/settings providers` wizard can fetch the models available to your key from `GET /v1/models`.

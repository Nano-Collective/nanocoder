---
title: "Atlas Cloud"
description: "Configure Atlas Cloud as a cloud AI provider for Nanocoder"
sidebar_order: 17
---

# Atlas Cloud

[Atlas Cloud](https://www.atlascloud.ai) provides an OpenAI-compatible API that gives access to models from OpenAI, Anthropic, Google, and other providers through a single endpoint.

## Configuration

```json
{
	"name": "Atlas Cloud",
	"baseUrl": "https://api.atlascloud.ai/v1",
	"apiKey": "your-atlas-cloud-api-key",
	"models": ["your-model-name"]
}
```

## Setup

1. Sign up at [atlascloud.ai](https://www.atlascloud.ai)
2. Generate an API key from the [developer console](https://www.atlascloud.ai/developer)
3. Browse the [model catalog](https://www.atlascloud.ai/models) - the model ID shown there is the exact string to use in `models`

## Fetching Available Models

The `/settings providers` wizard can automatically fetch available models from your Atlas Cloud account.

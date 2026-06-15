---
title: "Atlas Cloud"
description: "Configure Atlas Cloud as a cloud AI provider for Nanocoder"
sidebar_order: 17
---

# Atlas Cloud

[Atlas Cloud](https://www.atlascloud.ai) is a full-modal AI inference platform that exposes video, image, and LLM models through a single API. Rather than wiring up a separate integration per vendor, you connect once and get unified access to 300+ curated models across every modality. For Nanocoder, the relevant slice is its OpenAI-compatible LLM endpoint, which works as a drop-in coding provider.

> **Coding plan:** Atlas Cloud runs a budget-friendly coding plan promotion for cheaper API access. See [atlascloud.ai/console/coding-plan](https://www.atlascloud.ai/console/coding-plan).

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

The `/setup-providers` wizard can automatically fetch available models from your Atlas Cloud account.

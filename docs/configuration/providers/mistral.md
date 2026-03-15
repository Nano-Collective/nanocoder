---
title: "Mistral AI"
description: "Configure Mistral AI as a cloud AI provider for Nanocoder"
sidebar_order: 12
---

# Mistral AI

[Mistral AI](https://mistral.ai) provides high-performance language models including Codestral for code generation.

## Configuration

```json
{
	"name": "Mistral",
	"baseUrl": "https://api.mistral.ai/v1",
	"apiKey": "your-mistral-api-key",
	"models": ["your-model-name"]
}
```

## Setup

1. Create an account at [console.mistral.ai](https://console.mistral.ai)
2. Generate an API key from the console

## Fetching Available Models

The `/setup-providers` wizard can automatically fetch available models from your Mistral account.

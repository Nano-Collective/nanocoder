---
title: "OpenAI"
description: "Configure OpenAI as a cloud AI provider for Nanocoder"
sidebar_order: 11
---

# OpenAI

Use OpenAI's GPT models directly via their API.

## Configuration

```json
{
	"name": "OpenAI",
	"baseUrl": "https://api.openai.com/v1",
	"apiKey": "your-openai-api-key",
	"models": ["your-model-name"]
}
```

### Organization ID

If your API key is associated with multiple organizations, specify which one to use:

```json
{
	"name": "OpenAI",
	"baseUrl": "https://api.openai.com/v1",
	"apiKey": "your-openai-api-key",
	"organizationId": "your-org-id",
	"models": ["your-model-name"]
}
```

## Setup

1. Create an account at [platform.openai.com](https://platform.openai.com)
2. Generate an API key from the [API keys page](https://platform.openai.com/api-keys)

## Fetching Available Models

The `/setup-providers` wizard can automatically fetch available models from your OpenAI account.

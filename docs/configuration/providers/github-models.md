---
title: "GitHub Models"
description: "Configure GitHub Models as a cloud AI provider for Nanocoder"
sidebar_order: 13
---

# GitHub Models

[GitHub Models](https://github.com/marketplace/models) provides access to AI models from multiple providers through GitHub's infrastructure.

## Configuration

```json
{
	"name": "GitHub Models",
	"baseUrl": "https://models.github.ai/inference",
	"apiKey": "your-github-pat",
	"models": ["your-model-name"]
}
```

## Setup

1. Create a GitHub Personal Access Token (PAT) with the `models:read` scope
2. Browse available models at [github.com/marketplace/models](https://github.com/marketplace/models)

## Fetching Available Models

The `/setup-providers` wizard can automatically fetch available models from GitHub Models.

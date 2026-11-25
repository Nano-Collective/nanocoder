---
title: "Rapid-MLX"
description: "Configure Rapid-MLX as a local AI provider for Nanocoder"
sidebar_order: 8
---

# Rapid-MLX

[Rapid-MLX](https://rapidmlx.com) is an Apple Silicon inference server built on MLX that provides an OpenAI-compatible API at `http://localhost:8000/v1`.

## Configuration

Add the following entry to `nanocoder.providers` in [`agents.config.json`](../index.md):

```json
{
	"name": "Rapid-MLX",
	"baseUrl": "http://localhost:8000/v1",
	"models": ["mlx-community/Qwen3.5-4B-MLX-4bit"]
}
```

No API key is required for local use.

## Setup

```bash
pip install rapid-mlx
rapid-mlx serve qwen3.5-4b-4bit
```

Once the server is running, Nanocoder's `/settings providers` wizard can automatically fetch available models from `GET /v1/models`.

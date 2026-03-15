---
title: "MLX Server"
description: "Configure MLX Server as a local AI provider for Nanocoder"
sidebar_order: 4
---

# MLX Server

[MLX](https://github.com/ml-explore/mlx) is Apple's machine learning framework optimized for Apple Silicon. MLX Server provides an OpenAI-compatible API for MLX models.

## Configuration

```json
{
	"name": "MLX Server",
	"baseUrl": "http://localhost:8080/v1",
	"models": ["local-model"]
}
```

No API key is required for local use.

## Setup

```bash
pip install mlx-lm
mlx_lm.server --model mlx-community/model-name
```

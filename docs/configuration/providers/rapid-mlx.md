---
title: "Rapid-MLX"
description: "Configure Rapid-MLX as a local AI provider for Nanocoder"
sidebar_order: 8
---

# Rapid-MLX

[Rapid-MLX](https://github.com/raullenchai/Rapid-MLX) is an Apple Silicon inference server built on MLX that provides an OpenAI-compatible API at `http://localhost:8000/v1`.

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

Install Rapid-MLX with Homebrew or via pip (Python 3.12+):

```bash
brew install rapid-mlx
# or
pip install rapid-mlx

rapid-mlx serve qwen3.5-4b-4bit --port 8000
```

Once the server is running, Nanocoder's `/settings providers` wizard can automatically fetch available models from `GET /v1/models`.

Note: Port `8000` is also commonly used by vLLM. Passing `--port 8000` disables Rapid-MLX's automatic port fallback (`8000`–`8009`), so if port `8000` is already in use, start Rapid-MLX with a different `--port` and update `baseUrl` to match.

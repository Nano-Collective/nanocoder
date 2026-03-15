---
title: "llama.cpp"
description: "Configure llama.cpp server as a local AI provider for Nanocoder"
sidebar_order: 2
---

# llama.cpp

[llama.cpp](https://github.com/ggml-org/llama.cpp) provides high-performance local inference with an OpenAI-compatible API server.

## Configuration

```json
{
	"name": "llama-cpp",
	"baseUrl": "http://localhost:8080/v1",
	"models": ["your-model-name"]
}
```

No API key is required for local use.

## Setup

Start the server with a model:

```bash
llama-server -m model.gguf --port 8080
```

## Context Length

Set the context size as high as your system's memory can handle when starting the server:

```bash
llama-server -m model.gguf --ctx-size 32768
```

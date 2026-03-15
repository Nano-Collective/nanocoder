---
title: "Ollama"
description: "Configure Ollama as a local AI provider for Nanocoder"
sidebar_order: 1
---

# Ollama

[Ollama](https://ollama.com) is a popular tool for running large language models locally. It provides an OpenAI-compatible API out of the box.

## Configuration

```json
{
	"name": "Ollama",
	"baseUrl": "http://localhost:11434/v1",
	"models": ["your-model-name"]
}
```

No API key is required for local use.

## Setup

1. [Install Ollama](https://ollama.com/download)
2. Pull a model: `ollama pull your-model-name`
3. Ollama starts automatically and serves on port `11434`

## Context Length

By default, Ollama uses a 2048 token context window which is too small for agentic coding. Set the context length as high as your system's memory can handle — larger context means the model can track more of the conversation history, tool calls, and file contents.

```bash
OLLAMA_NUM_CTX=32768 ollama serve
```

Or set it permanently in your environment.

## Fetching Available Models

The `/setup-providers` wizard can automatically fetch your installed Ollama models when configuring this provider.

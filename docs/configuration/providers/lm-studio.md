---
title: "LM Studio"
description: "Configure LM Studio as a local AI provider for Nanocoder"
sidebar_order: 3
---

# LM Studio

[LM Studio](https://lmstudio.ai) is a desktop application for running local models with a built-in OpenAI-compatible API server.

## Configuration

```json
{
	"name": "LM Studio",
	"baseUrl": "http://localhost:1234/v1",
	"models": ["local-model"]
}
```

No API key is required for local use.

## Setup

1. Download and install LM Studio
2. Download a model from the built-in model browser
3. Start the local server from the "Local Server" tab

## Context Length

Increase "Context Length" in Settings > Model Settings as high as your system's memory can handle. Larger context allows the model to track more conversation history, tool calls, and file contents.

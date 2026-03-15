---
title: "llama-swap"
description: "Configure llama-swap as a local AI provider for Nanocoder"
sidebar_order: 7
---

# llama-swap

[llama-swap](https://github.com/mostlygeek/llama-swap) is a model multiplexer for llama.cpp that allows you to serve multiple models through a single endpoint, automatically loading and unloading models on demand.

## Configuration

```json
{
	"name": "llama-swap",
	"baseUrl": "http://localhost:9292/v1",
	"models": ["model-1", "model-2"]
}
```

No API key is required for local use.

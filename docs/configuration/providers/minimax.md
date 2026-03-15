---
title: "MiniMax Coding"
description: "Configure MiniMax Coding Plan as a native AI provider for Nanocoder"
sidebar_order: 24
---

# MiniMax Coding Plan

[MiniMax](https://www.minimax.io) provides AI models through an Anthropic-compatible API endpoint.

## Configuration

```json
{
	"name": "MiniMax Coding",
	"sdkProvider": "anthropic",
	"baseUrl": "https://api.minimax.io/anthropic/v1",
	"apiKey": "your-minimax-api-key",
	"models": ["your-model-name"]
}
```

The `sdkProvider: "anthropic"` field is required as MiniMax's API uses the Anthropic message format.

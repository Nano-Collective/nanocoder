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
	"models": ["MiniMax-M3", "MiniMax-M2.7"]
}
```

The `sdkProvider: "anthropic"` field is required as MiniMax's API uses the Anthropic message format.

## Output Token Ceiling

`@ai-sdk/anthropic` caps replies at 4096 tokens for model ids it does not recognise as Claude models, which includes the MiniMax models. Long replies are cut off mid-sentence with no error. Set `maxOutputTokens` on the provider entry to raise the ceiling, keeping it within what the endpoint allows. See [Output Token Ceiling](index.md#output-token-ceiling).

---
title: "Kimi Code"
description: "Configure Kimi Code as a native AI provider for Nanocoder"
sidebar_order: 23
---

# Kimi Code

[Kimi](https://kimi.com) provides a coding-focused API that uses an Anthropic-compatible protocol.

## Configuration

```json
{
	"name": "Kimi Code",
	"sdkProvider": "anthropic",
	"baseUrl": "https://api.kimi.com/coding/v1",
	"apiKey": "your-kimi-api-key",
	"models": ["your-model-name"]
}
```

The `sdkProvider: "anthropic"` field is required as Kimi's coding API uses the Anthropic message format.

## Output Token Ceiling

`@ai-sdk/anthropic` caps replies at 4096 tokens for model ids it does not recognise as Claude models, which includes `kimi-for-coding` and the other Kimi models. Long replies are cut off mid-sentence with no error. Set `maxOutputTokens` on the provider entry to raise the ceiling, keeping it within what the endpoint allows. See [Output Token Ceiling](index.md#output-token-ceiling).

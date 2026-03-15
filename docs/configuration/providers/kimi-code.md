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

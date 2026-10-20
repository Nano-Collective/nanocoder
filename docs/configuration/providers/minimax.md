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
	"models": ["MiniMax-M3.1-Flash", "MiniMax-M3"]
}
```

The `sdkProvider: "anthropic"` field selects MiniMax's Anthropic-compatible message format. New configurations list MiniMax-M3.1-Flash first, with MiniMax-M3 as an alternative. The China endpoint is `https://api.minimax.cn/anthropic/v1`.

[MiniMax M Plan](https://platform.minimax.io/docs/m-plan/other-tools) documents MiniMax-M3.1-Flash with a Subscription Key. Choose models supported by your account; the example does not imply M3 subscription entitlement.

Discovery offers only current MiniMax text models on the official endpoints. On OpenRouter and OpenCode Zen, it offers the verified gateway IDs only when the gateway returns them: `minimax/minimax-m3.1-flash:free` / `minimax/minimax-m3` and `minimax-m3.1-flash-free` / `minimax-m3`, respectively. Existing model lists and manually entered legacy or custom IDs are preserved, including on custom endpoints.

## Output Token Ceiling

`@ai-sdk/anthropic` caps replies at 4096 tokens for model ids it does not recognise as Claude models, which includes the MiniMax models. Long replies are cut off mid-sentence with no error. Set `maxOutputTokens` on the provider entry to raise the ceiling, keeping it within what the endpoint allows. See [Output Token Ceiling](index.md#output-token-ceiling).

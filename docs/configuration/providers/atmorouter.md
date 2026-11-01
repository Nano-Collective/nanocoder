---
title: "AtmoRouter"
description: "Configure AtmoRouter as a cloud AI provider for Nanocoder"
sidebar_order: 28
---

# AtmoRouter

[AtmoRouter](https://atmorouter.dev/) is a usage-based gateway that gives you a single OpenAI-compatible endpoint and API key for models from several upstream providers. It speaks the OpenAI Chat Completions API, including streaming and tool calling, so it works with Nanocoder's existing OpenAI-compatible client.

## Configuration

```json
{
	"name": "AtmoRouter",
	"baseUrl": "https://atmorouter.dev/v1",
	"apiKey": "${ATMOROUTER_API_KEY}",
	"models": ["cc/claude-sonnet-4-6"]
}
```

## Setup

1. Create an account and an API key on the [API keys page](https://atmorouter.dev/dashboard/keys). Keys start with `ar-`.
2. Paste the key into the `/settings providers` wizard, or export `ATMOROUTER_API_KEY` and reference it as `"${ATMOROUTER_API_KEY}"` in `apiKey` as shown above. Nanocoder does not read the variable on its own; it is only picked up through that substitution.

See the [AtmoRouter docs](https://atmorouter.dev/docs) for account setup.

## Models

Model IDs carry an upstream prefix and are passed through unchanged, for example:

- `cc/claude-sonnet-4-6`
- `cbcn/glm-5.3`
- `ali/deepseek-v4.1-flash`
- `ali/qwen3.8-max`

The current catalog is at `https://atmorouter.dev/v1/models`, and the `/settings providers` wizard can fetch it once you enter a key.

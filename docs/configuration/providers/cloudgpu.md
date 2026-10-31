---
title: "CloudGPU"
description: "Configure CloudGPU as a cloud AI provider for Nanocoder"
sidebar_order: 28
---

# CloudGPU

[CloudGPU](https://cloudgpu.app/) provides an OpenAI-compatible model API at `https://cloudgpu.app/v1`. Nanocoder uses its existing OpenAI-compatible client with the CloudGPU endpoint, so no extra SDK is needed.

## Configuration

```json
{
	"name": "CloudGPU",
	"baseUrl": "https://cloudgpu.app/v1",
	"apiKey": "${CLOUDGPU_API_KEY}",
	"models": ["kimi-k3"]
}
```

## Setup

1. Create an account and an API key at [CloudGPU](https://cloudgpu.app/).
2. Enter the key in the `/settings providers` wizard. For a manual configuration, set `CLOUDGPU_API_KEY` in your environment and reference it with `${CLOUDGPU_API_KEY}` as shown above. Nanocoder resolves that reference; it does not read the variable automatically.
3. Pick the exact model IDs you want, for example `kimi-k3`, `glm-5.2` or `deepseek-v4-pro`. The current catalog is available at `https://cloudgpu.app/v1/models`, and the [API docs](https://cloudgpu.app/api/docs) cover usage.

The wizard can fetch available models from the CloudGPU endpoint after you provide a key.

---
title: "Runcrate"
description: "Configure Runcrate as a cloud AI provider for Nanocoder"
sidebar_order: 31
---

# Runcrate

[Runcrate](https://www.runcrate.ai/?utm_source=nanocoder&utm_medium=listing&utm_campaign=gpu_pricing) is a GPU cloud that also serves open models, such as DeepSeek V4.1 Flash, GLM-5.3, Qwen3.8 Flash and gpt-oss 120B, on an OpenAI-compatible API. It speaks the OpenAI Chat Completions API, including streaming and tool calling, so it works as a drop-in coding provider for Nanocoder. Five open models (DeepSeek V4.1 Flash, GLM-5.3, GLM-5.3 Flash, Qwen3.8 Flash and gpt-oss 120B) include a limited [free allowance](https://www.runcrate.ai/inference/free?utm_source=nanocoder&utm_medium=listing&utm_campaign=gpu_pricing) when you sign in with a GitHub account that is at least 30 days old. The allowance is shared by the workspace and resets per session and weekly; past it, requests are billed from your balance or stop until it resets.

## Configuration

```json
{
	"name": "Runcrate",
	"baseUrl": "https://api.runcrate.ai/v1",
	"apiKey": "${RUNCRATE_API_KEY}",
	"models": ["deepseek-ai/DeepSeek-V4.1-Flash"]
}
```

## Setup

1. Sign in to [Runcrate](https://www.runcrate.ai/?utm_source=nanocoder&utm_medium=listing&utm_campaign=gpu_pricing) with GitHub. The free allowance applies only when you sign in with a GitHub account that is at least 30 days old.
2. Create an API key in the [Runcrate dashboard](https://www.runcrate.ai/dashboard/api-keys?utm_source=nanocoder&utm_medium=listing&utm_campaign=gpu_pricing) (keys start with `rc_live_`). The same page shows how much free usage is left and when it resets.
3. Set `RUNCRATE_API_KEY`, or paste the key into the wizard

## Models

Model names use the `vendor/model` form and are passed through unchanged, for example:

- `deepseek-ai/DeepSeek-V4.1-Flash`
- `zai-org/GLM-5.3`
- `zai-org/GLM-5.3-Flash`
- `Qwen/Qwen3.8-Flash`
- `openai/gpt-oss-120b`

The current catalog is public at `https://api.runcrate.ai/v1/models`. Enter the model IDs you want in the wizard's model field, separated by commas.

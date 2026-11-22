---
title: "Runcrate"
description: "Configure Runcrate as a cloud AI provider for Nanocoder"
sidebar_order: 31
---

# Runcrate

[Runcrate](https://www.runcrate.ai) serves open models such as DeepSeek V4.1 Flash, GLM-5.3, Qwen3.8 Flash and gpt-oss 120B on an OpenAI-compatible API, including streaming and tool calling.

Some open models include a limited free allowance for GitHub accounts of a minimum age. The allowance, its terms and the list of eligible models are set by Runcrate and can change, so check the [Runcrate dashboard](https://www.runcrate.ai/dashboard/api-keys) for what applies to your account.

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

1. Sign in to [Runcrate](https://www.runcrate.ai) and create an API key in the [dashboard](https://www.runcrate.ai/dashboard/api-keys) (keys start with `rc_live_`)
2. Paste the key into the wizard, or set `RUNCRATE_API_KEY` in your environment and reference it with `${RUNCRATE_API_KEY}`. Nanocoder resolves that reference; it does not read the variable automatically

## Models

Model names use the `vendor/model` form and are passed through unchanged, for example:

- `deepseek-ai/DeepSeek-V4.1-Flash`
- `zai-org/GLM-5.3`
- `zai-org/GLM-5.3-Flash`
- `Qwen/Qwen3.8-Flash`
- `openai/gpt-oss-120b`

The catalog at `https://api.runcrate.ai/v1/models` also lists image, video and audio models, which Nanocoder cannot use. Enter the chat model IDs you want in the wizard's model field, separated by commas.

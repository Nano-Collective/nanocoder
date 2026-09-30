---
title: "ChatGPT / Codex"
description: "Configure ChatGPT / Codex as a native AI provider for Nanocoder"
sidebar_order: 23
---

# ChatGPT / Codex

Use your existing ChatGPT subscription to access Codex models through Nanocoder. Authentication uses a device-code login: Nanocoder shows a URL and a one-time code, you open the URL in any browser and enter the code. No API key is needed.

## Configuration

```json
{
	"name": "ChatGPT",
	"sdkProvider": "chatgpt-codex",
	"baseUrl": "https://chatgpt.com/backend-api/codex",
	"models": ["your-model-name"]
}
```

The `sdkProvider: "chatgpt-codex"` field enables the ChatGPT/Codex authentication flow.

## Setup

1. Ensure you have an active [ChatGPT subscription](https://chatgpt.com)
2. Log in, either inside Nanocoder with `/codex-login [provider-name]` or from a shell with `nanocoder codex login [provider-name]`
3. Credentials are cached locally and refreshed automatically

Credentials are stored under the provider name you log in with, and looked up by the exact `name` of the provider entry. Both commands default to `ChatGPT`, as does the `/settings providers` wizard. If you name the provider something else, pass the same name when logging in, for example `nanocoder codex login "Work ChatGPT"`.

## Reasoning Traces

GPT-5 and other reasoning models return chain-of-thought only when the Responses API is asked to emit it. Nanocoder sets `reasoningSummary: "auto"` and `reasoningEffort: "medium"` by default for this provider so reasoning shows up in the `⚙ Thinking` block out of the box. Toggle visibility with **Ctrl+R** or set `reasoningExpanded: true` in your preferences.

Override either setting with a `tune.modelParameters` block on the provider entry in `agents.config.json` (or on the top-level `nanocoder.tune`, or with `/tune`):

```json
{
	"name": "ChatGPT",
	"sdkProvider": "chatgpt-codex",
	"tune": {
		"modelParameters": {
			"reasoningEffort": "high",
			"reasoningSummary": "detailed"
		}
	},
	"baseUrl": "https://chatgpt.com/backend-api/codex",
	"models": ["your-model-name"]
}
```

- `reasoningEffort`: `"minimal" | "low" | "medium" | "high"`. Higher values let the model think longer.
- `reasoningSummary`: `"auto" | "concise" | "detailed"`. Controls how much reasoning text is returned.

## Notes

- No API key is required. Authentication is handled by the device-code login described above
- The default provider name is `ChatGPT`. The name you log in with must match the provider's `name` exactly for credential lookup to work
- Available models depend on your ChatGPT subscription tier

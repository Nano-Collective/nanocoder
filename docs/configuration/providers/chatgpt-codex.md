---
title: "ChatGPT / Codex"
description: "Configure ChatGPT / Codex as a native AI provider for Nanocoder"
sidebar_order: 23
---

# ChatGPT / Codex

Use your existing ChatGPT subscription to access Codex models through Nanocoder. Authentication is handled via a browser-based login flow — no API key needed.

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
2. Run `/codex-login` inside Nanocoder to authenticate via your browser
3. Credentials are cached locally and refreshed automatically

## Notes

- No API key is required — authentication is handled via a browser-based login flow
- The default provider name is `ChatGPT` — this must match the name in your configuration for credential lookup to work
- Available models depend on your ChatGPT subscription tier

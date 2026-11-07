---
title: "OpenLLM"
description: "Configure OpenLLM as a router for your API keys, subscriptions and local models in Nanocoder"
sidebar_order: 8
---

# OpenLLM

[OpenLLM](https://www.openllm.sh) routes your API keys, OAuth subscription accounts and local models through one endpoint. It runs on your machine and extends to the cloud, so the same accounts work locally, from your other devices and in CI. It is format agnostic: clients can speak Chat Completions, Responses or Anthropic Messages, and Nanocoder uses Chat Completions.

## Configuration

```json
{
	"name": "OpenLLM",
	"baseUrl": "http://127.0.0.1:8787/v1",
	"models": ["ultra", "plus", "lite"]
}
```

No API key is needed in Nanocoder. The daemon uses the account you signed in with.

## Setup

1. Install OpenLLM: `curl -fsSL https://www.openllm.sh/install | bash`
2. Sign in with `openllm login`. It opens the browser by default. Use `openllm login --api-key` to paste a key instead.
3. Start the daemon with `openllm start`
4. In Nanocoder, run `/settings providers`, and select **OpenLLM**

`ultra`, `plus` and `lite` are tier aliases. Run `curl http://127.0.0.1:8787/v1/models` to list every model the daemon exposes, and add any of those IDs to `models`.

## CI and hosted use (no install)

Where nothing can be installed, such as CI runners, point Nanocoder at the OpenLLM cloud with an API key from your [OpenLLM account](https://www.openllm.sh/sign-in), stored as a secret:

```json
{
	"name": "OpenLLM",
	"baseUrl": "https://www.openllm.sh/v1",
	"apiKey": "$OPENLLM_API_KEY",
	"models": ["ultra", "plus", "lite"]
}
```

Subscription models are served through one of your devices running OpenLLM, so keep one online. Models backed by API keys work without one.

OpenLLM also provides an MCP server (`openllm mcp`) that you can add as a separate integration. See the [OpenLLM documentation](https://docs.openllm.sh).

## Troubleshooting

- Not signed in: Nanocoder requests fail with an auth error. Run `openllm login`, then try again.
- Daemon not running: connection to `127.0.0.1:8787` is refused. Run `openllm start`.
- Not installed: Nanocoder shows the install command, `curl -fsSL https://www.openllm.sh/install | bash`.

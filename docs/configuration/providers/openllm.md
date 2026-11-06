---
title: "OpenLLM"
description: "Configure OpenLLM as a local AI gateway for Nanocoder"
sidebar_order: 31
---

# OpenLLM

[OpenLLM](https://www.openllm.sh) is a local gateway. It connects your subscription accounts and API keys and serves them through one OpenAI-compatible endpoint on your machine. Nanocoder talks to the local daemon, which takes care of provider routing and fallback.

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

1. Install OpenLLM from [openllm.sh/install](https://www.openllm.sh/install)
2. Sign in with `openllm login`. It opens the browser by default. Use `openllm login --api-key` to paste a key instead.
3. Start the daemon with `openllm start`
4. In Nanocoder, run `/settings providers`, and select **OpenLLM**

`ultra`, `plus` and `lite` are tier aliases. Run `curl http://127.0.0.1:8787/v1/models` to list every model the daemon exposes, and add any of those IDs to `models`.

OpenLLM also provides an MCP server (`openllm mcp`) that you can add as a separate integration. See the [OpenLLM documentation](https://docs.openllm.sh).

## Troubleshooting

- Not signed in: Nanocoder requests fail with an auth error. Run `openllm login`, then try again.
- Daemon not running: connection to `127.0.0.1:8787` is refused. Run `openllm start`.

---
title: "AI Providers"
description: "Configure AI providers for Nanocoder including Ollama, OpenRouter, and more"
sidebar_order: 2
---

# AI Provider Setup

Nanocoder supports multiple AI providers including any OpenAI-compatible API, native Anthropic, Google Gemini, and GitHub Copilot through a unified provider configuration.

## Configuration Methods

1. **Interactive Setup (Recommended for new users)**: Run `/setup-providers` inside Nanocoder for a guided wizard with provider templates. The wizard allows you to:
   - Choose between project-level or global configuration
   - Select from common provider templates
   - Add custom OpenAI-compatible providers manually
   - Edit or delete existing providers
   - Fetch available models automatically from your provider
2. **Manual Configuration**: Create an `agents.config.json` file (see [Configuration](../index.md) for file locations)

> **Note**: The `/setup-providers` wizard requires at least one provider to be configured before saving. You cannot exit without adding a provider.

## Local Providers

Run on your machine, typically no API key required.

- [Ollama](ollama.md) - Popular local model runner
- [llama.cpp](llama-cpp.md) - High-performance inference server
- [LM Studio](lm-studio.md) - Desktop app for running local models
- [MLX Server](mlx-server.md) - Apple Silicon optimized inference
- [vLLM](vllm.md) - High-throughput serving engine
- [LocalAI](localai.md) - OpenAI-compatible local API
- [llama-swap](llama-swap.md) - Model multiplexer for llama.cpp

## Cloud Providers (OpenAI-Compatible)

Hosted services using the OpenAI-compatible API format.

- [OpenRouter](openrouter.md) - Unified API for multiple AI providers
- [OpenAI](openai.md) - GPT models via OpenAI's API
- [Mistral AI](mistral.md) - Mistral and Codestral models
- [GitHub Models](github-models.md) - AI models via GitHub's marketplace
- [Poe](poe.md) - Access multiple AI models through Poe
- [Z.ai](z-ai.md) - GLM models from Zhipu AI
- [Z.ai Coding](z-ai-coding.md) - Z.ai coding subscription plan

## Native SDK Providers

Use dedicated AI SDK packages for native API support, enabled via the `sdkProvider` field.

- [Anthropic Claude](anthropic.md) - Native Anthropic API support
- [Google Gemini](gemini.md) - Native Google Gemini support
- [GitHub Copilot](github-copilot.md) - GitHub Copilot with device OAuth
- [ChatGPT / Codex](chatgpt-codex.md) - ChatGPT Codex with browser login
- [Kimi Code](kimi-code.md) - Kimi's Anthropic-compatible coding API
- [MiniMax Coding](minimax.md) - MiniMax Anthropic-compatible API

## Other

- [Custom Provider](custom.md) - Add any OpenAI-compatible API manually

## Provider Configuration Fields

| Field | Description |
|-------|-------------|
| `name` | Display name used in `/provider` command |
| `baseUrl` | API endpoint URL |
| `apiKey` | API key (optional, not required for local providers or GitHub Copilot) |
| `models` | Available model list for `/model` command |
| `sdkProvider` | AI SDK provider to use (see below, defaults to `openai-compatible`) |
| `organizationId` | Organization ID for OpenAI (optional) |
| `disableTools` | Disable tool calling for the entire provider (optional, boolean) |
| `disableToolModels` | List of model names to disable tool calling for (optional) |
| `requestTimeout` | Overall request timeout in milliseconds (default: 120,000). Set to `-1` to disable (optional) |
| `socketTimeout` | Socket-level timeout in milliseconds, uses `requestTimeout` if not set. Set to `-1` to disable (optional) |
| `connectionPool` | Connection pool settings (optional, see [Timeouts & Connection Pooling](#timeouts--connection-pooling)) |

### `sdkProvider` Options

| Value | Description |
|-------|-------------|
| `openai-compatible` | Default. Works with any OpenAI-compatible API |
| `google` | Native Google Gemini support via `@ai-sdk/google` |
| `anthropic` | Native Anthropic support via `@ai-sdk/anthropic`. Also used by Kimi Code and MiniMax |
| `github-copilot` | GitHub Copilot with device OAuth authentication |

## Environment Variable Overrides

Override provider configurations via environment variables. These take **highest precedence**, overriding both project and global config files when the same provider name exists.

| Variable | Description |
|----------|-------------|
| `NANOCODER_PROVIDERS` | JSON string containing provider configurations |
| `NANOCODER_PROVIDERS_FILE` | Path to a JSON file (used if `NANOCODER_PROVIDERS` is not set) |

The JSON value accepts a direct array, or the standard `agents.config.json` wrapper formats:

```bash
# Direct array
export NANOCODER_PROVIDERS='[{"name":"my-provider","baseUrl":"http://localhost:1234/v1","models":["model-1"]}]'

# Wrapper format
export NANOCODER_PROVIDERS='{"nanocoder":{"providers":[{"name":"my-provider","baseUrl":"http://localhost:1234/v1","models":["model-1"]}]}}'

# File-based
export NANOCODER_PROVIDERS_FILE=/path/to/providers.json
```

**Precedence order:** Environment variables > Project `agents.config.json` > Global `agents.config.json`

## Environment Variable Substitution

API keys and other config values support environment variable substitution:

- `$VAR_NAME` - simple variable reference
- `${VAR_NAME}` - braced reference
- `${VAR_NAME:-default}` - reference with default value

```json
{
	"name": "OpenRouter",
	"baseUrl": "https://openrouter.ai/api/v1",
	"apiKey": "${OPENROUTER_API_KEY}",
	"models": ["your-model-name"]
}
```

## Timeouts & Connection Pooling

By default, requests timeout after 2 minutes (120,000 ms). For local models that may take longer to respond, you can increase or disable timeouts.

It is recommended to set both `requestTimeout` and `socketTimeout` to the same value for consistent behavior. Set both to `-1` to disable timeouts entirely.

The `connectionPool` object accepts:

| Field | Description |
|-------|-------------|
| `idleTimeout` | How long an idle connection stays alive in the pool (default: 4,000 ms) |
| `cumulativeMaxIdleTimeout` | Maximum total idle time for a connection (default: 600,000 ms) |

```json
{
	"nanocoder": {
		"providers": [
			{
				"name": "llama-cpp",
				"baseUrl": "http://localhost:8080/v1",
				"models": ["qwen3-coder:a3b", "deepseek-v3.1"],
				"requestTimeout": -1,
				"socketTimeout": -1,
				"connectionPool": {
					"idleTimeout": 30000,
					"cumulativeMaxIdleTimeout": 3600000
				}
			}
		]
	}
}
```

## Troubleshooting Context Length Issues

If you experience the model repeating tool calls or getting into loops (especially with multi-turn conversations), this is often caused by insufficient context length settings in your local AI provider. Set the context length as high as your system's memory can handle — agentic coding conversations need large context to track tool calls, file contents, and conversation history.

- **LM Studio**: Increase "Context Length" in Settings > Model Settings
- **Ollama**: Set context length with `OLLAMA_NUM_CTX=32768`
- **llama.cpp**: Use `--ctx-size 32768` or higher when starting the server
- **vLLM**: Set `--max-model-len 32768` when launching

If the context window is too small, the model may lose track of previous actions and repeat them indefinitely.

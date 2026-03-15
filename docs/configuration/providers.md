---
title: "AI Providers"
description: "Configure AI providers for Nanocoder including Ollama, OpenRouter, and more"
sidebar_order: 2
---

# AI Provider Setup

Nanocoder supports any OpenAI-compatible API through a unified provider configuration.

## Configuration Methods

1. **Interactive Setup (Recommended for new users)**: Run `/setup-providers` inside Nanocoder for a guided wizard with provider templates. The wizard allows you to:
   - Choose between project-level or global configuration
   - Select from common provider templates (Ollama, OpenRouter, LM Studio, Kimi Code, etc.)
   - Add custom OpenAI-compatible providers manually
   - Edit or delete existing providers
   - Fetch available models automatically from your provider
2. **Manual Configuration**: Create an `agents.config.json` file (see [Configuration](index.md) for file locations)

> **Note**: The `/setup-providers` wizard requires at least one provider to be configured before saving. You cannot exit without adding a provider.

## Example Configuration

```json
{
	"nanocoder": {
		"providers": [
			{
				"name": "llama-cpp",
				"baseUrl": "http://localhost:8080/v1",
				"models": ["qwen3-coder:a3b", "deepseek-v3.1"]
			},
			{
				"name": "Ollama",
				"baseUrl": "http://localhost:11434/v1",
				"models": ["qwen2.5-coder:14b", "llama3.2"]
			},
			{
				"name": "OpenRouter",
				"baseUrl": "https://openrouter.ai/api/v1",
				"apiKey": "your-openrouter-api-key",
				"models": ["openai/gpt-4o-mini", "anthropic/claude-3-haiku"]
			},
			{
				"name": "LM Studio",
				"baseUrl": "http://localhost:1234/v1",
				"models": ["local-model"]
			},
			{
				"name": "Z.ai",
				"baseUrl": "https://api.z.ai/api/paas/v4/",
				"apiKey": "your-z.ai-api-key",
				"models": ["glm-4.7", "glm-4.5", "glm-4.5-air"]
			},
			{
				"name": "Z.ai Coding Subscription",
				"baseUrl": "https://api.z.ai/api/coding/paas/v4/",
				"apiKey": "your-z.ai-coding-api-key",
				"models": ["glm-4.7", "glm-4.5", "glm-4.5-air"]
			},
			{
				"name": "GitHub Models",
				"baseUrl": "https://models.github.ai/inference",
				"apiKey": "your-github-pat",
				"models": ["openai/gpt-4o-mini", "meta/llama-3.1-70b-instruct"]
			},
			{
				"name": "Poe",
				"baseUrl": "https://api.poe.com/v1",
				"apiKey": "your-poe-api-key",
				"models": ["Claude-Sonnet-4", "GPT-4o", "Gemini-2.5-Pro"]
			},
			{
				"name": "Gemini",
				"sdkProvider": "google",
				"baseUrl": "https://generativelanguage.googleapis.com/v1beta",
				"apiKey": "your-gemini-api-key",
				"models": ["gemini-3-flash-preview", "gemini-3-pro-preview"]
			}
		]
	}
}
```

## Common Provider Examples

- **llama.cpp server**: `"baseUrl": "http://localhost:8080/v1"`
- **llama-swap**: `"baseUrl": "http://localhost:9292/v1"`
- **Ollama (Local)**: `"baseUrl": "http://localhost:11434/v1"`
- **OpenRouter (Cloud)**: `"baseUrl": "https://openrouter.ai/api/v1"`
- **LM Studio**: `"baseUrl": "http://localhost:1234/v1"`
- **vLLM**: `"baseUrl": "http://localhost:8000/v1"`
- **LocalAI**: `"baseUrl": "http://localhost:8080/v1"`
- **OpenAI**: `"baseUrl": "https://api.openai.com/v1"`
- **Poe**: `"baseUrl": "https://api.poe.com/v1"` (get API key from [poe.com/api_key](https://poe.com/api_key))
- **GitHub Models**: `"baseUrl": "https://models.github.ai/inference"` (requires PAT with `models:read` scope)
- **Z.ai**: `"baseUrl": "https://api.z.ai/api/paas/v4/"`
- **Z.ai Coding**: `"baseUrl": "https://api.z.ai/api/coding/paas/v4/"`
- **Kimi Code**: `"sdkProvider": "anthroopic"`, `"baseUrl": "https://api.kimi.com/coding/v1"`
- **Google Gemini**: `"sdkProvider": "google"` (get API key from [aistudio.google.com/apikey](https://aistudio.google.com/apikey))

## Provider Configuration Fields

- `name`: Display name used in `/provider` command
- `baseUrl`: OpenAI-compatible API endpoint
- `apiKey`: API key (optional, may not be required)
- `models`: Available model list for `/model` command
- `disableToolModels`: List of model names to disable tool calling for (optional)
- `sdkProvider`: AI SDK provider package to use (optional, defaults to `openai-compatible`)
  - `openai-compatible`: Default, works with any OpenAI-compatible API
  - `google`: Use `@ai-sdk/google` for native Google Gemini support (required for Gemini 3 models with tool calling)
  - `anthropic`: Use `@ai-sdk/anthropic` for providers that require it like Kimi Coding

## Troubleshooting Context Length Issues

If you experience the model repeating tool calls or getting into loops (especially with multi-turn conversations), this is often caused by insufficient context length settings in your local AI provider:

- **LM Studio**: Increase "Context Length" in Settings > Model Settings (recommended: 8192 or higher)
- **Ollama**: Set context length with `OLLAMA_NUM_CTX=8192`
- **llama.cpp**: Use `--ctx-size 8192` or higher when starting the server
- **vLLM**: Set `--max-model-len 8192` when launching

Tool-calling conversations require more context to track the history of tool calls and their results. If the context window is too small, the model may lose track of previous actions and repeat them indefinitely.

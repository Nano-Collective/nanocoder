---
"@nanocollective/nanocoder": patch
---

Refresh the default models suggested by the provider setup wizard so new configs no longer start on retired or outdated ids. ChatGPT / Codex now defaults to `gpt-6.1-sol` (gpt-5.3-codex is no longer served), Together AI to `deepseek-ai/DeepSeek-V4-Pro-0813` (the undated V4-Pro id was removed from serverless), Poe to `claude-sonnet-5.5` (Poe does not serve gpt-5.6-sol), and MiniMax Coding to `MiniMax-M3.1-Flash,MiniMax-M3` (M2.7 retires on 2026-11-18).

Other defaults move to each provider's current flagship: OpenAI, GitHub Copilot, API Route, Requesty, OrcaRouter, FutureInfra and Atlas Cloud to GPT-6.1 Sol, Anthropic to `claude-sonnet-5-5`, OpenRouter to `anthropic/claude-sonnet-5.5`, Gemini to `gemini-3.8-flash`, Z.ai and Z.ai Coding to `glm-5.3`, Thesean to `ship-like/claude-opus-5-5`, and Ollama to `qwen3.8`. The Kimi Code template now uses the international endpoint `https://api.kimi.ai/coding/v1`, and the provider docs show current model ids.
